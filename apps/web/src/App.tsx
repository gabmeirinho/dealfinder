import type { ReactElement } from "react";

export const appName = "Dealfinder" as const;

export function App(): ReactElement {
  return (
    <main>
      <h1>{appName}</h1>
      <p>The local dashboard will be added in a later phase-one commit.</p>
    </main>
  );
}

