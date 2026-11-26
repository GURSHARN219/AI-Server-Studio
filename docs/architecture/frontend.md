# Frontend architecture

The React/Vite frontend lives under `app/`. `app/src/api` and `app/src/lib`
centralize same-origin requests, authentication headers and SSE transport.
Feature pages remain organized under `app/src/pages`, with chat, settings,
models, workflows, voice and media components preserved from the prior UI.

Production output is `app/dist`; the root Go `frontend` package embeds it into
the application binary. Development runs Vite directly with `npm run dev`; the
production executable never starts Vite.

Mermaid code blocks render in the browser through the maintained `mermaid`
package. Generated SVG is validated before insertion, and loading, syntax and
render failures are shown in the code block UI. There is no Mermaid rendering
service dependency.
