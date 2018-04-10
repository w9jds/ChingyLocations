import * as Logging from '@google-cloud/logging';
import { Severity, Metadata } from '../models/Log';
import { Request } from 'hapi';


export class Logger {
    private projectId = 'new-eden-storage-a5c23';
    private logName = this.name;
    private logger;
    private resource = {
        type: 'container',
        labels: {
            cluster_name: 'chingy-webapi',
            container_name: this.name,
            namespace_id: 'default',
            project_id: this.projectId
        }
    }

    constructor(private name: string) {
        const logging = new Logging({ projectId: this.projectId });
        this.logger = logging.log(this.logName);
    }

    public log = (severity: Severity, labels: {[key:string]: string}, content): Promise<any> => {
        let metadata: Metadata = {
            resource: this.resource,
            severity,
            labels
        };

        return this.logger.write(this.logger.entry(metadata, content));
    }

    public logHttp = async (method: string, response: Response, body: any): Promise<any> => {
        let metadata: Metadata = {
            severity: response.status >= 200 && response.status < 300 ? Severity.INFO : Severity.ERROR,
            resource: this.resource,
            httpRequest: {
                requestUrl: response.url,
                status: response.status,
                requestMethod: method
            }
        };

        return this.logger.write(
            this.logger.entry(metadata, {
                headers: response.headers,
                body
            })
        );
    }
}

