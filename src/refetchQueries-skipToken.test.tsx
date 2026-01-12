import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import {
  ApolloClient,
  InMemoryCache,
  gql,
  ApolloLink,
  Observable,
} from "@apollo/client";
import { ApolloProvider, useQuery, skipToken } from "@apollo/client/react";

// GraphQL query with a REQUIRED variable
const GET_USER_QUERY = gql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
    }
  }
`;

// Track all network requests
let networkRequests: Array<{ operationName: string; variables: any }> = [];

// Create a mock link that tracks requests
const createMockLink = () => {
  return new ApolloLink((operation) => {
    networkRequests.push({
      operationName: operation.operationName,
      variables: operation.variables,
    });

    return new Observable((observer) => {
      // Simulate network response
      setTimeout(() => {
        observer.next({
          data: {
            user: {
              id: operation.variables.id || "unknown",
              name: "Test User",
              email: "test@example.com",
            },
          },
        });
        observer.complete();
      }, 10);
    });
  });
};

const UserComponent = ({ userId }: { userId: string | null | undefined }) => {
  const { data, loading, error } = useQuery(
    GET_USER_QUERY,
    userId ? { variables: { id: userId } } : skipToken
  );

  if (loading) return <div data-testid="loading">Loading...</div>;
  if (error) return <div data-testid="error">Error: {error.message}</div>;
  if (!data) return <div data-testid="no-data">No user selected</div>;

  return (
    <div data-testid="user-data">
      <p>Name: {data.user.name}</p>
      <p>Email: {data.user.email}</p>
    </div>
  );
};

describe("Apollo Client Issue #12996: refetchQueries with skipToken", () => {
  let client: ApolloClient;

  beforeEach(() => {
    networkRequests = [];
    client = new ApolloClient({
      cache: new InMemoryCache(),
      link: createMockLink(),
      // Comment this to fix the issue
      defaultOptions: {
        watchQuery: {
          fetchPolicy: "cache-and-network",
        },
      },
    });
  });

  afterEach(() => {
    client.stop();
  });

  it("Scenario 1: Query starts with skipToken, never executed - refetchQueries should NOT trigger it", async () => {
    const TestApp = () => {
      return (
        <ApolloProvider client={client}>
          {/* userId is null, so query uses skipToken */}
          <UserComponent userId={undefined} />
        </ApolloProvider>
      );
    };

    render(<TestApp />);

    // Wait for component to render with "no data" state
    await waitFor(() => {
      expect(screen.getByTestId("no-data")).toBeInTheDocument();
    });

    // At this point, NO network requests should have been made
    expect(networkRequests).toHaveLength(0);

    // Now call refetchQueries - this SHOULD NOT trigger a request
    // because the query was never executed (it's using skipToken)
    await act(async () => {
      await client.refetchQueries({
        include: [GET_USER_QUERY],
      });
    });

    // Check if bug exists - if networkRequests > 0, the bug is present
    const hasBug = networkRequests.length > 0;
    console.log(
      `\n[Scenario 1] Requests after refetchQueries: ${networkRequests.length}`
    );
    console.log(`[Scenario 1] Bug present: ${hasBug}`);
    if (hasBug) {
      console.log(
        `[Scenario 1] Variables sent: ${JSON.stringify(
          networkRequests[0]?.variables
        )}`
      );
    }

    expect(
      networkRequests,
      `
      Expected: No network requests (query never executed)
      Actual: ${networkRequests.length} request(s) made
      
      If this fails, the issue is present.
      Network requests: ${JSON.stringify(networkRequests, null, 2)}
    `
    ).toHaveLength(0);
  });
});
