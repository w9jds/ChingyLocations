declare module NodeJS {
    interface Global {
        firebase: import('firebase-admin').app.App;
        logger: import('node-esi-stackdriver').Logger;
        esi: import('node-esi-stackdriver').Esi;
    }
}

declare const firebase: import('firebase-admin').app.App;
declare const logger: import('node-esi-stackdriver').Logger;
declare const esi: import('node-esi-stackdriver').Esi;