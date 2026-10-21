import type { Config } from '@netlify/functions';
import { app } from '../../server/app.ts';

export default (req: Request) => app.fetch(req);

export const config: Config = {
  path: ['/api/*', '/mcp', '/s/*'],
};
