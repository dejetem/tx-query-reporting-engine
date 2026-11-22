import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.API_URL || 'http://127.0.0.1:3001';

const listDuration = new Trend('list_duration');
const summaryDuration = new Trend('summary_duration');

export const options = {
  vus: 30,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<200'],
  },
};

export default function () {
  const listRes = http.get(
    `${BASE_URL}/v1/transactions?tenantId=tenant-alpha&limit=50`,
  );
  listDuration.add(listRes.timings.duration);
  check(listRes, { 'list status 200': (r) => r.status === 200 });

  const summaryRes = http.get(
    `${BASE_URL}/v1/transactions/summary?tenantId=tenant-alpha`,
  );
  summaryDuration.add(summaryRes.timings.duration);
  check(summaryRes, { 'summary status 200': (r) => r.status === 200 });
}
