type UserError = {
    error: boolean;
    content?: any;
    user: {
        id: string;
        name: string;
    }
}