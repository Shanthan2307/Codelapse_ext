import { NextResponse } from 'next/server';
import { findAssignment } from '@/lib/course';
import { SUBMISSION_COLUMNS, answerColumns, buildResearchExport } from '@/lib/research/export';
import { researchSalt } from '@/lib/research/pseudonym';
import { toCsv } from '@/lib/research/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pseudonymised research data for an assignment.
 * GET /api/research/export?assignment=a3-reverse&format=csv|json&table=answers|submissions&includeText=0|1
 * CSV returns one table; JSON returns both. Instructor-only.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const assignment = url.searchParams.get('assignment') ?? '';
  const format = url.searchParams.get('format') ?? 'csv';
  const table = url.searchParams.get('table') ?? 'answers';
  const includeText = url.searchParams.get('includeText') === '1';

  if (!findAssignment(assignment)) {
    return NextResponse.json({ error: 'Unknown assignment.' }, { status: 404 });
  }
  if (format !== 'csv' && format !== 'json') {
    return NextResponse.json({ error: 'format must be csv or json.' }, { status: 400 });
  }
  if (table !== 'answers' && table !== 'submissions') {
    return NextResponse.json({ error: 'table must be answers or submissions.' }, { status: 400 });
  }

  const data = await buildResearchExport(assignment, { salt: await researchSalt(), includeText });
  const stamp = new Date(data.generatedAt).toISOString().slice(0, 10);
  if (format === 'json') {
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="codelapse-${assignment}-${stamp}.json"`
      }
    });
  }
  const csv =
    table === 'answers' ? toCsv(answerColumns(includeText), data.answers) : toCsv(SUBMISSION_COLUMNS, data.submissions);
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="codelapse-${assignment}-${table}-${stamp}.csv"`
    }
  });
}
