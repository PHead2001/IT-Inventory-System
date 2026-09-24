'use client';

import { SpeedInsights } from '@vercel/speed-insights/next';
import { beforeSendPrivateVitals } from './speed-insights';

export function PrivateSpeedInsights() {
  return <SpeedInsights beforeSend={beforeSendPrivateVitals} debug={false} />;
}
