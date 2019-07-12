type UserError = {
    error: boolean;
    content?: any;
    user: {
        id: string | number;
        name: string;
    }
}