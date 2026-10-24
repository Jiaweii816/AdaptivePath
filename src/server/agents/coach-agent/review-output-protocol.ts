// Single source of truth for the Review output protocol, shared by the prompt
// builder and parser. The reply is emitted before this sentinel line and the
// diagnosis JSON after it, so markdown never has to live inside JSON.
export const DIAGNOSIS_SENTINEL = "<<<DIAGNOSIS_JSON>>>";
