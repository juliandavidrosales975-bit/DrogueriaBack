import { Router } from 'express';
import { AuditService } from './audit.service';
import { requireAuth, authorize } from '@shared/middlewares/auth.middleware';
import { ALL_ADMINS } from '@shared/utils/roles';

const auditRouter: Router = Router();
const auditService = new AuditService();

auditRouter.use(requireAuth, authorize(...ALL_ADMINS));

auditRouter.get('/', async (req, res, next) => {
  try {
    const data = await auditService.list({
      entityType: req.query.entityType as string,
      entityId: req.query.entityId as string,
      userId: req.query.userId as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

auditRouter.get('/:entityType/:entityId', async (req, res, next) => {
  try {
    const data = await auditService.getByEntity(
      req.params.entityType as string,
      req.params.entityId as string
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

export { auditRouter };
