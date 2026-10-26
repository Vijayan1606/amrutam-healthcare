import { Router, Request, Response, NextFunction } from 'express';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schemas';
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  logoutAll,
  forgotPassword,
  resetPassword,
  getCurrentUser,
} from './auth.service';
import { authenticate } from '../../common/middleware/auth';

const router = Router();

function getMeta(req: Request) {
  return {
    ipAddress: req.ip ?? req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    correlationId: req.correlationId,
  };
}

// POST /api/v1/auth/register
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = registerSchema.parse(req.body);
    const result = await registerUser(input, getMeta(req));
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = loginSchema.parse(req.body);
    const result = await loginUser(input, getMeta(req));
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = refreshSchema.parse(req.body);
    const result = await refreshAccessToken(input, getMeta(req));
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/logout
router.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = logoutSchema.parse(req.body);
    await logoutUser(input.refreshToken, req.user!.sub, { correlationId: req.correlationId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/logout-all
router.post(
  '/logout-all',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await logoutAll(req.user!.sub, { correlationId: req.correlationId });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/auth/me
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getCurrentUser(req.user!.sub);
    res.status(200).json({ data: user });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/forgot-password
router.post(
  '/forgot-password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = forgotPasswordSchema.parse(req.body);
      await forgotPassword(input, { correlationId: req.correlationId });
      // Always return success — do not reveal account existence
      res.status(200).json({
        data: { message: 'If that email exists, a reset link has been sent.' },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/auth/reset-password
router.post(
  '/reset-password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = resetPasswordSchema.parse(req.body);
      await resetPassword(input, { correlationId: req.correlationId });
      res.status(200).json({
        data: { message: 'Password reset successfully. Please log in with your new password.' },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
