import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { Prisma, type RunStatus, type Run, type Step } from '@prisma/client';

const router = Router();

router.get('/runs', async (req: Request, res: Response) => {
  try {
    const {
      pipelineName,
      status,
      startDate,
      endDate,
      limit = '50',
      offset = '0',
    } = req.query;

    const where: Prisma.RunWhereInput = {};

    if (pipelineName) {
      where.pipelineName = pipelineName as string;
    }

    if (status) {
      where.status = status as RunStatus;
    }

    if (startDate || endDate) {
      where.startedAt = {};
      if (startDate) {
        where.startedAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.startedAt.lte = new Date(endDate as string);
      }
    }

    const runs: Run[] = await prisma.run.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
      include: {
        steps: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            stepName: true,
            stepType: true,
            order: true,
            status: true,
            startedAt: true,
            endedAt: true,
            metrics: true,
            summary: true,
          },
        },
      },
    });

    res.json({ runs });
  } catch (error: any) {
    console.error('Error querying runs:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/runs/:runId', async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;

    const run = await prisma.run.findUnique({
      where: { id: runId },
      include: {
        steps: {
          orderBy: { order: 'asc' },
          include: {
            stepDetails: true,
          },
        },
      },
    });

    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    res.json({ run });
  } catch (error: any) {
    console.error('Error fetching run:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;

