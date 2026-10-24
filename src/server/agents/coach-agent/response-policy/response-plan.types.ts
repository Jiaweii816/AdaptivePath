import type {
  Operation,
  OperationFamily,
  TurnModifiers,
} from "../turn-understanding/turn-understanding.types";

export type ResponseObjective = {
  operationId: string;
  family: OperationFamily;
  target: Operation["target"];
  dependsOn: string[];
};

export type ResponsePlan = {
  backbone: {
    family: OperationFamily;
    topic?: Operation["topic"];
    target: Operation["target"];
  };
  objectives: ResponseObjective[];
  modifiers: TurnModifiers;
  compound: boolean;
  pureDurable: boolean;
  hasPendingRequiredAction: boolean;
};
