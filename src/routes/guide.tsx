import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/guide")({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: "/methodology",
      search: { tab: "guide" },
      hash: location.hash,
      replace: true,
    });
  },
});
