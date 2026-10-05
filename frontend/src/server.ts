import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { createServer } from 'node:http';

const app = express();
const browserDistFolder = join(import.meta.dirname, '../browser');
const angularApp = new AngularNodeAppEngine({ allowedHosts: ['*'] });
const httpServer = createServer(app);

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all non-API requests by rendering the Angular application via SSR.
 */
app.use((req: any, res: any, next: any) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});


if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4200;
  httpServer.listen(port, () => {
    console.log(`Angular SSR frontend listening on http://localhost:${port}`);
  });
}


export const reqHandler = createNodeRequestHandler(app);
