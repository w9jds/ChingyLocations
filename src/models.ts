
type CharacterLocation = {
    id: number;
    name: string;
    corpId: number;
    allianceId?: number;
    location?: {
        system: {
            id: number;
            name?: string;
        }
    },
    ship?: {
        name: string;
        typeId: number;
        type?: string;
        itemId: number;
    }
};

type UserError = {
    error: boolean;
    content?: any;
    user: {
        id: string;
        name: string;
    }
}