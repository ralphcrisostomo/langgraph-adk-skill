# LangGraph Primitives Cheat-Sheet

> Always confirm exact signatures with context7 before emitting code — this is a
> map of what exists, not a pinned API.

## Single agent (ReAct)

```ts
import { createAgent, tool } from 'langchain';
const agent = createAgent({ model, tools: [t1, t2], prompt: '...' });
const out = await agent.invoke({ messages: [{ role: 'user', content: '...' }] });
```

## Tools

```ts
import { tool } from '@langchain/core/tools';
import * as z from 'zod';
const search = tool(async ({ q }) => '...', {
  name: 'search', description: '...', schema: z.object({ q: z.string() }),
});
// Progress-reporting tool: async function* + `yield { message, progress }`.
```

## Graph (sequential / branching / loops)

```ts
import { StateGraph, START, END } from '@langchain/langgraph';
const graph = new StateGraph(State)
  .addNode('a', aFn)
  .addNode('b', bFn)
  .addEdge(START, 'a')
  .addConditionalEdges('a', router, ['b', END])  // router returns next node name(s)
  .addEdge('b', 'a')                               // loop back
  .compile();
```

## Patterns → primitives

- **Sequential**: linear `addEdge` chain.
- **Parallel**: fan-out edges from one node → N nodes; join via a reducer state key.
- **Loop & Critic**: `addConditionalEdges` cycling back until a quality gate passes.
- **Coordinator / Routing**: a router node returning the next node by `Command`/conditional edges (supervisor).
- **Orchestrator-Worker / Map-Reduce**: `Send('worker', payload)` from a conditional edge to spawn dynamic workers; collect via a concat reducer.
- **Agent as Tool**: wrap `subAgent.invoke(...)` inside a `tool(...)` and give it to an outer agent.

## Reducers & dynamic fan-out

```ts
import { StateSchema, ReducedValue, Send } from '@langchain/langgraph';
const State = new StateSchema({
  items: new ReducedValue(z.array(z.string()).default(() => []), { reducer: (a, b) => a.concat(b) }),
});
// in a conditional edge: return subjects.map((s) => new Send('worker', { subject: s }));
```

## Streaming (verbose runtime)

```ts
for await (const [mode, chunk] of await graph.stream(input, { streamMode: ['updates', 'tools'] })) {
  // 'updates' -> node-level state; 'tools' -> on_tool_start/event/end/error
}
```
Use the project's `runGraphVerbose(graph, input, ctx.spinner)` instead of calling
`.stream` directly — it renders nodes/tools with chalk + ora.
