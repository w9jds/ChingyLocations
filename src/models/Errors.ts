export type UserError = {
  error: boolean;
  content?: any;
  user: {
    id: string;
    name: string;
  }
}

export type TimeoutError = {
  id: number;
  type: string;
  error: boolean;
  contents: string;
}