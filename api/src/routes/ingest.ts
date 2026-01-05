import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { type RunStatus, type StepType, type StepStatus } from '@prisma/client';
import { type XRayEvent } from '../types';

const router = Router();

router.post('/events', async (req: Request, res: Response) => {
  try {
    const { events }: { events: XRayEvent[] } = req.body;

    if (!Array.isArray(events)) {
      return res.status(400).json({ error: 'events must be an array' });
    }

    // Process events in batch
    for (const event of events) {
      await processEvent(event);
    }

    res.json({ success: true, processed: events.length });
  } catch (error: any) {
    console.error('Error processing events:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

async function processEvent(event: XRayEvent): Promise<void> {
  const timestamp = new Date(event.timestamp);

  switch (event.type) {
    case 'run_started':
      if (event.run) {
        await prisma.run.upsert({
          where: { id: event.run.id },
          create: {
            id: event.run.id,
            pipelineName: event.run.pipelineName,
            status: (event.run.status || 'running') as RunStatus,
            startedAt: timestamp,
            metadata: event.run.metadata || {},
          },
          update: {
            pipelineName: event.run.pipelineName,
            status: (event.run.status || 'running') as RunStatus,
            metadata: event.run.metadata || {},
          },
        });
      }
      break;

    case 'run_ended':
      if (event.run) {
        await prisma.run.update({
          where: { id: event.run.id },
          data: {
            status: (event.run.status || 'success') as RunStatus,
            endedAt: timestamp,
            metadata: event.run.metadata || {},
          },
        });
      }
      break;

    case 'step_started':
      if (event.step) {
        // Step will be created/updated when step_ended event arrives
      }
      break;

    case 'step_ended':
      if (event.step) {
        const stepData = event.step;
        const details = stepData.details || {};

        const step = await prisma.step.upsert({
          where: { id: stepData.id },
          create: {
            id: stepData.id,
            runId: stepData.runId,
            stepName: stepData.stepName,
            stepType: stepData.stepType as StepType,
            order: stepData.order,
            status: (stepData.status || 'success') as StepStatus,
            startedAt: timestamp,
            endedAt: timestamp,
            metrics: stepData.metrics || {},
            summary: generateSummary(stepData),
          },
          update: {
            stepName: stepData.stepName,
            stepType: stepData.stepType as StepType,
            status: (stepData.status || 'success') as StepStatus,
            endedAt: timestamp,
            metrics: stepData.metrics || {},
            summary: generateSummary(stepData),
          },
        });

        // Create or update step details
        await prisma.stepDetails.upsert({
          where: { stepId: stepData.id },
          create: {
            stepId: stepData.id,
            input: details.input,
            output: details.output,
            reasoning: details.reasoning,
            filtersApplied: details.filtersApplied,
            candidatesSample: details.candidatesSample,
            candidatesStats: details.candidatesStats,
          },
          update: {
            input: details.input,
            output: details.output,
            reasoning: details.reasoning,
            filtersApplied: details.filtersApplied,
            candidatesSample: details.candidatesSample,
            candidatesStats: details.candidatesStats,
          },
        });
      }
      break;
  }
}

function generateSummary(step: XRayEvent['step']): string | null {
  if (!step) return null;

  const parts: string[] = [];
  
  if (step.metrics) {
    if (step.metrics.candidateCountBefore && step.metrics.candidateCountAfter) {
      const dropRate = 1 - (step.metrics.candidateCountAfter as number) / (step.metrics.candidateCountBefore as number);
      parts.push(`${step.metrics.candidateCountBefore} → ${step.metrics.candidateCountAfter} (${(dropRate * 100).toFixed(1)}% drop)`);
    }
  }

  if (step.status) {
    parts.push(`Status: ${step.status}`);
  }

  return parts.length > 0 ? parts.join(' | ') : null;
}

export default router;

