# Examples

## competitor-selection.ts

A complete example showing how to instrument a competitor selection pipeline. This demonstrates:
- Multiple step types (LLM, retrieval, filter, ranking, selection)
- Detailed metrics and filtering information
- Candidate sampling for large datasets
- Error handling

Run it:
```bash
# Make sure the API is running first
cd ../api && npm run dev

# In another terminal
cd examples
npx ts-node competitor-selection.ts
```

## minimal-example.ts

The absolute minimum code needed to get value from X-Ray. Shows how to instrument a simple pipeline in <5 minutes.

Run it:
```bash
npx ts-node minimal-example.ts
```

