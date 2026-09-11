// Dependency-free guidance shared by slash snippets and new local note bodies.
// Prompts are editable starting points, not required properties or workflow state.
export const NOTE_PROMPTS = Object.freeze({
  noiseQuestion: "What is unclear, and what would understanding it enable?",
  noiseContext: "Where did it arise, and does it block the current task?",
  noiseResearch: "What needs to be learned next?",
  noiseOutcome: "What is the result of investigating this noise?",
  waveResult: "What result are we working toward?",
  waveBoundary: "What is inside the task, outside it, and already needed?",
  waveInstruction:
    "What actions lead to the result, and what does each depend on?",
  waveDeviation: "What could interrupt this path?",
  waveClosure: "What was verified, or why should this work not continue?",
});

export const DEFAULT_NOTE_BODY_TEMPLATE = [
  "# {{name}}",
  "",
  "## Noise",
  "",
  `**${NOTE_PROMPTS.noiseQuestion}**`,
  "",
  `**${NOTE_PROMPTS.noiseContext}**`,
  "",
  `**${NOTE_PROMPTS.noiseResearch}**`,
  "",
  "*When the path is clear, use /wave in this same note for dependency-ordered actions and verification. Keep the originating context linked; split only distinct results into separate waves.*",
  "",
].join("\n");
