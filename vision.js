/* =========================================================================
   vision.js — CLIENT-side task config only.

   The actual model call, the prompts, and their no-fabrication safety rules
   live on the server (/api/vision) so the front end never touches an API key.
   The browser only needs, per task: how large a frame to capture (small print
   needs more pixels) and the spoken title shown while it works.
   ========================================================================= */

export const TASKS = {
  describe:  { title: "Describing the scene",       maxDim: 1280 },
  read:      { title: "Reading the text",           maxDim: 1600 },
  medicine:  { title: "Reading the medicine label", maxDim: 1600 },
  translate: { title: "Translating the sign",       maxDim: 1600 },
  ask:       { title: "Answering your question",     maxDim: 1600 },
};

export function taskTitle(task) {
  return (TASKS[task] && TASKS[task].title) || "Result";
}
