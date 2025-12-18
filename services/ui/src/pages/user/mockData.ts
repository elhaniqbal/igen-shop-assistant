export type ToolModel = {
  tool_model_id: string;
  name: string;
  category: string;
  available: number;
  total: number;
};

export type Loan = {
  loan_id: string;
  tool_item_id: string; // TOOL-001-A style label
  name: string;
  category: string;
  issued_at: string;
  due_at: string;
};

export const TOOL_MODELS: ToolModel[] = [
  { tool_model_id: "wire_cutters", name: "Wire Cutters", category: "Electrical Tools", available: 3, total: 5 },
  { tool_model_id: "wire_strippers", name: "Wire Strippers", category: "Electrical Tools", available: 3, total: 4 },
  { tool_model_id: "crimpers", name: "Crimpers", category: "Electrical Tools", available: 3, total: 4 },
  { tool_model_id: "crimp_connectors", name: "Crimp Connectors", category: "Electrical Tools", available: 4, total: 5 },
];

export const INITIAL_LOANS: Loan[] = [
  {
    loan_id: "loan_1",
    tool_item_id: "TOOL-001-C",
    name: "Wire Cutters",
    category: "Electrical Tools",
    issued_at: "2025-11-22 08:30",
    due_at: "2025-11-22 16:30",
  },
  {
    loan_id: "loan_2",
    tool_item_id: "TOOL-001-A",
    name: "Wire Cutters",
    category: "Electrical Tools",
    issued_at: "2025-11-22 12:30",
    due_at: "2025-11-22 20:30",
  },
];
