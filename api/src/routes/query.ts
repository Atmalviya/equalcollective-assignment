import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { Prisma, type RunStatus, type Run, type Step, type StepType, type StepStatus } from '@prisma/client';

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
      const validStatuses: RunStatus[] = ['running', 'success', 'failed', 'partial'];
      if (validStatuses.includes(status as RunStatus)) {
        where.status = status as RunStatus;
      } else {
        return res.status(400).json({ 
          error: `Invalid status: ${status}. Valid values are: ${validStatuses.join(', ')}` 
        });
      }
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


router.get('/runs/:runId/steps/:stepId', async (req: Request, res: Response) => {
  try {
    const { runId, stepId } = req.params;

    const step = await prisma.step.findFirst({
      where: {
        id: stepId,
        runId: runId,
      },
      include: {
        stepDetails: true,
        run: {
          select: {
            id: true,
            pipelineName: true,
            status: true,
          },
        },
      },
    });

    if (!step) {
      return res.status(404).json({ error: 'Step not found' });
    }

    res.json({ step });
  } catch (error: any) {
    console.error('Error fetching step:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.post('/query/steps', async (req: Request, res: Response) => {
  try {
    const { filters = [], include = [], limit = 100, offset = 0 } = req.body;

    const where: Prisma.StepWhereInput = {};

    // Process filters
    for (const filter of filters) {
      const { field, op, value } = filter;

      if (field === 'stepType') {
        if (op === 'eq') {
          const validStepTypes: StepType[] = ['llm', 'filter', 'retrieval', 'ranking', 'selection', 'other'];
          if (validStepTypes.includes(value as StepType)) {
            where.stepType = value as StepType;
          } else {
            return res.status(400).json({ 
              error: `Invalid stepType: ${value}. Valid values are: ${validStepTypes.join(', ')}` 
            });
          }
        }
      } else if (field === 'stepName') {
        if (op === 'eq') {
          where.stepName = value;
        } else if (op === 'contains') {
          where.stepName = { contains: value };
        }
      } else if (field === 'status') {
        if (op === 'eq') {
          const validStatuses: StepStatus[] = ['success', 'failed', 'skipped'];
          if (validStatuses.includes(value as StepStatus)) {
            where.status = value as StepStatus;
          } else {
            return res.status(400).json({ 
              error: `Invalid status: ${value}. Valid values are: ${validStatuses.join(', ')}` 
            });
          }
        }
      } else if (field === 'runId') {
        if (op === 'eq') {
          where.runId = value;
        }
      } else if (field === 'pipelineName') {
        where.run = { pipelineName: value };
      } else if (field.startsWith('metrics.')) {
        const metricKey = field.replace('metrics.', '');
        const metricValue = typeof value === 'number' ? value : parseFloat(value);
        
        if (op === 'gt') {
          where.metrics = {
            path: [metricKey],
            gt: metricValue,
          } as Prisma.JsonFilter;
        } else if (op === 'gte') {
          where.metrics = {
            path: [metricKey],
            gte: metricValue,
          } as Prisma.JsonFilter;
        } else if (op === 'lt') {
          where.metrics = {
            path: [metricKey],
            lt: metricValue,
          } as Prisma.JsonFilter;
        } else if (op === 'lte') {
          where.metrics = {
            path: [metricKey],
            lte: metricValue,
          } as Prisma.JsonFilter;
        } else if (op === 'eq') {
          where.metrics = {
            path: [metricKey],
            equals: metricValue,
          } as Prisma.JsonFilter;
        }
      }
    }

    const includeOptions: Prisma.StepInclude = {};
    if (include.includes('run')) {
      includeOptions.run = true;
    }
    if (include.includes('stepDetails')) {
      includeOptions.stepDetails = true;
    }

    const [steps, count] = await Promise.all([
      prisma.step.findMany({
        where,
        include: includeOptions,
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.step.count({ where }),
    ]);

    res.json({ steps, count });
  } catch (error: any) {
    console.error('Error querying steps:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;

