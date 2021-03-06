import { Request } from 'express';
import { InsertWriteOpResult } from 'mongodb';
import { importDbEntries } from '../../dal/import';
import { applyTracing } from '../../utils/tracer';
import { CSEResponse } from '../../server';
import { IClaim } from '../../models/claim';

export const handler = async (req: Request, res: CSEResponse): Promise<void> => {
  const { dbClient, searchClient } = res.locals;
  let result: InsertWriteOpResult | undefined;
  try {
    const output: IClaim[] = await importDbEntries();
    await dbClient.connect();
    result = await dbClient.insert(output);
    await searchClient.insert(await dbClient.getClaims());
    await dbClient.close();
    res.status(200);
  } catch (err) {
    res.status(500);
  }
  res.header('Content-Type', 'application/json');
  res.send(result ? result.result : 'insert failed');
};

export const dbInit = applyTracing('/init', handler);
