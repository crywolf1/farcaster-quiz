import { NextResponse } from 'next/server';

// GET /api/debug-env - Check environment variables (REMOVE IN PRODUCTION!)
export async function GET() {
  const envVars = {
    STORAGE_REST_API_URL: process.env.STORAGE_REST_API_URL ? 'SET' : 'NOT SET',
    STORAGE_REST_API_TOKEN: process.env.STORAGE_REST_API_TOKEN ? 'SET' : 'NOT SET',
    KV_REST_API_URL: process.env.KV_REST_API_URL ? 'SET' : 'NOT SET',
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN ? 'SET' : 'NOT SET',
    // Show first few characters of URL to debug
    STORAGE_URL_START: process.env.STORAGE_REST_API_URL?.substring(0, 30) || 'N/A',
    KV_URL_START: process.env.KV_REST_API_URL?.substring(0, 30) || 'N/A',
  };

  return NextResponse.json(envVars);
}
