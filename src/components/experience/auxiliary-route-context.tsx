'use client';

import { createContext } from 'react';
import type { createAuxiliaryRouteCapture } from './auxiliary-route-capture';

export const AuxiliaryRouteCaptureContext = createContext<ReturnType<
  typeof createAuxiliaryRouteCapture
> | null>(null);
