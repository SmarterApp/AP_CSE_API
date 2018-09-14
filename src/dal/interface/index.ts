import { MongoClient, Db, Collection, InsertWriteOpResult, Cursor } from 'mongodb';
import { ITargetParams } from '../../routes/target/index';
import { IClaim } from '../../models/claim/index';

export interface IDbClient {
    url: string;
    port: number;
    dbName: string;
}

/**
 * This class encaspulates and handles communication with Elasticsearch and
 * MongoDB.
 */
export class DbClient {
    public uri: string;
    public dbName: string;
    private db?: Db;

    constructor(args: IDbClient) {
        this.uri = `${args.url}:${args.port}`;
        this.dbName = args.dbName;
    }

    // tslint:disable:no-floating-promises
    public async connect(): Promise<void> {
        let client: MongoClient;
        try {
            client = await MongoClient.connect(this.uri, { auth: { user: 'root', password: 'example' } });
            this.db = client.db(this.dbName);
        } catch (err) {
            throw err;
        }
    }

    public async insert(json: object[]): Promise<InsertWriteOpResult> {
        let result: InsertWriteOpResult;
        // tslint:disable-next-line:no-any
        let collections: Collection<any>[];
        if (this.db) {
            try {
                collections = await this.db.collections();
                if(collections && collections.find(collection => collection.collectionName === 'claims')) {
                    await this.db.dropCollection('claims');
                }
                this.db.createCollection('claims');
                result = await this.db.collection('claims').insertMany(json);
            } catch (error) {
                throw error;
            }

            return result;
        } else {
            throw new Error('db is not defined');
        }
    }

    public async getTargets(searchParams: ITargetParams): Promise<IClaim[]> {
        const { subject, grades, claimNumber, targetShortCode } = searchParams;
        let result: IClaim[];
        if (this.db) {
            try {
                result = await this.db.collection('claims').find({
                    subject,
                    grades,
                    claimNumber,
                    'target.shortCode': targetShortCode
                }).toArray();
            } catch (error) {
                throw error;
            }
        } else {
            throw new Error('db is not defined');
        }

        return result;
    }

    public getBySearchParam(param: string): void {
        return;
    }

}