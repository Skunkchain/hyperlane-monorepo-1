import { Request, Response, Router } from 'express';

export function createHealthRouter(isReady: () => boolean): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    void res.sendStatus(200);
  });

  router.get('/readiness', (_req: Request, res: Response) => {
    void res.sendStatus(isReady() ? 200 : 503);
  });

  return router;
}
