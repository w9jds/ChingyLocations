import { database } from 'firebase-admin';
import { Character } from 'node-esi-stackdriver';
import { fork } from 'child_process';
import { ProcessResponse } from './models/Messages';

export type CharacterBase = Pick<Character, "id" | "name" | "accountId" | "corpId" | "allianceId" | "sso">

export default class Master {
    private concurrency = 500;
    private database = firebase.database();
    private users: Map<string, CharacterBase> = new Map();
    private channels: number = 0;

    constructor() {
        this.database.ref(`characters`).on('child_added', this.setUser);
        this.database.ref(`characters`).on('child_changed', this.setUser);
        this.database.ref(`characters`).on('child_removed', this.removeUser);
    }

    private setUser = (snapshot: database.DataSnapshot) => {
        let character: Character = snapshot.val();

        if ('accessToken' in character) {
            snapshot.child('accessToken').ref.remove();
        }
        if ('expiresAt' in character) {
            snapshot.child('expiresAt').ref.remove();
        }
        if ('refreshToken' in character) {
            snapshot.child('refreshToken').ref.remove();
        }

        this.users.set(snapshot.key, {
            id: character.id,
            name: character.name,
            accountId: character.accountId,
            corpId: character.corpId,
            allianceId: character.allianceId,
            sso: character.sso
        });

        this.startNewWorkers();
    }

    private removeUser = (snapshot: database.DataSnapshot) => {
        this.users.delete(snapshot.key);
    }


    private sleep = (seconds: number): Promise<void> => new Promise(resolve => {
        setTimeout(resolve, seconds * 1000)
    })

    private getNeededProcessesCount = () => Math.ceil(this.users.size / this.concurrency);

    private getIDsSubset = (index: number, keys: string[]) => {
        const startPosition = this.concurrency * (index - 1);
        const endPosition = startPosition + this.concurrency;
        return keys.slice(startPosition, endPosition);
    }
    
    public startNewWorkers = async () => {
        if (this.users.size < 1) {
            await this.sleep(6);
            this.startNewWorkers();
        }
        
        if (this.channels != this.getNeededProcessesCount()) {
            for (let i = this.getNeededProcessesCount() - this.channels; i > 0; i--) {
                this.forkShard();
            }
        }
    }
    
    private forkShard = () => {
        this.channels += 1;

        let forked, hrtime; 
        const index = this.channels;

        const startFork = () => {
            forked = fork(`locations.js`, [], {
                cwd: __dirname,
                env: process.env,
                execArgv: [
                    `--inspect-brk=${process.debugPort + index}`
                ]
            });
        }

        const channelClosed = async (code: number, signal: string) => {
            this.channels -= 1;

            forked.off('exit', channelClosed);
            forked.off('message', messageRecieved);
            startFork();
        }

        const messageRecieved = async (response: ProcessResponse) => {
            let executionTime = process.hrtime(hrtime);
            console.log(`Batch index ${index} finished in ${executionTime[0]}s`)

            if (response.error === true) {
                await this.sleep(response.backoff);
            }
            else if (executionTime[0] < 7) {
                await this.sleep(7 - executionTime[0]);
            }
            
            startProcess();
        }

        const startProcess = () => {
            hrtime = process.hrtime();
            forked.send(this.getIDsSubset(index, [...this.users.keys()]).map(key => this.users.get(key)));
        }
        
        startFork();
        forked.on('exit', channelClosed);
        forked.on('message', messageRecieved);
        startProcess();
    }
}