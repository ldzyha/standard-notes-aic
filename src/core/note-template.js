// Dependency-free guidance for explicit slash snippets and note templates.
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

// Newly created documents contain no generated content. The Noise/Wave prompts
// remain available through explicit slash snippets or an owner-selected template.
export const DEFAULT_NOTE_BODY_TEMPLATE = "";
