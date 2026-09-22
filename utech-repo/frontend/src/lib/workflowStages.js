// The plant's 17-stage manufacturing workflow, in order. Process.stage stores
// the name; the number is its position here (and in the plant's own notebook).
export const WORKFLOW_STAGES = [
  'Material Inward',
  'Material Verification',
  'Cutting',
  'Forming',
  'Fabrication',
  'Machining',
  'VMC Machining',
  'Other Machining',
  'Surface Finishing',
  'Surface Treatment',
  'Marking',
  'Assembly',
  'Inspection / Quality',
  'Testing',
  'Rework',
  'Packing',
  'Dispatch',
];

export const stageNumber = (stage) => {
  const i = WORKFLOW_STAGES.indexOf(stage);
  return i === -1 ? null : i + 1;
};

export const stageLabel = (stage) => {
  if (!stage) return 'Other';
  const n = stageNumber(stage);
  return n ? `${n}. ${stage}` : stage;
};
