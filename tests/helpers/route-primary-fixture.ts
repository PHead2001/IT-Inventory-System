import { build } from 'esbuild';
import { resolve } from 'node:path';

/** Renderer initiation only. Approval is supplied by this fictional fixture;
 * provider authorization/lifetime has separate real-provider component tests. */
export type RoutePrimaryFixtureKind =
  'primary' | 'paired' | 'history' | 'location';
export async function routePrimaryFixture(kind: RoutePrimaryFixtureKind) {
  const sourceRoute =
    kind === 'history'
      ? '/history?type=quantity'
      : kind === 'location'
        ? '/locations?selected=ITC-S1A'
        : '/inventory';
  const destinationRoute =
    kind === 'history'
      ? '/inventory/quantity/00000000-0000-4000-8000-000000000001'
      : kind === 'location'
        ? '/locations/ITC-S1A'
        : '/history';
  const conventionalSource = kind === 'history' || kind === 'location';
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
        import React, {startTransition, useState, ViewTransition} from 'react';
        import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom';
        import {RouteReady} from './src/components/experience/route-ready';
        import {InventoryCaptureRegion} from './src/components/experience/inventory-capture-region';
        import {createAuxiliaryRouteCapture} from './src/components/experience/auxiliary-route-capture';
        import {AuxiliaryRouteCaptureContext} from './src/components/experience/auxiliary-route-context';
        import {RoutePresentationSourceContext} from './src/components/experience/route-presentation-source';
        import {isInventoryCaptureName} from './src/components/experience/inventory-capture-regions';
        import {sharedTitleMotion} from './src/components/experience/shared-title-motion';
        const paired = ${kind !== 'primary'}, conventionalSource = ${conventionalSource};
        const sourceRoute = ${JSON.stringify(sourceRoute)}, destinationRoute = ${JSON.stringify(destinationRoute)};
        const auxiliary = createAuxiliaryRouteCapture(), source = Symbol();
        let enabled = true, privateReady = true, approval = null, current = true;
        const valid = () => enabled && privateReady && current;
        const proof = {starts:0, ready:false, finished:false, errors:[], names:[], callbacks:[], auxiliaryNames:[], releaseCount:0};
        const state = window.routePrimary = {proof};
        const native = document.startViewTransition;
        // Observation only: do not invoke the API, alter its callback, pause or
        // synthesize a transition. Only installed React may initiate capture.
        document.startViewTransition = function(...args) {
          proof.starts++;
          const transition = Reflect.apply(native, this, args);
          transition.ready.then(() => queueMicrotask(() => {
            proof.names = document.getAnimations().map(a=>a.effect?.pseudoElement).filter(Boolean);
            proof.ready = true;
          }), () => proof.errors.push('native-ready-rejected'));
          transition.finished.then(() => {proof.finished=true;}, () => proof.errors.push('native-finished-rejected'));
          return transition;
        };
        auxiliary.attach(document);
        state.motion = () => ({
          enabled:valid(), captureAvailable:true, current:()=>current, validNow:valid,
          intent: paired && approval ? {name:'primary-fixture-title',detailPath:destinationRoute,listHref:sourceRoute} : null,
          titleArrival: paired ? approval : null,
          arrival: paired ? null : approval,
          cancelIfInvalid:()=>{}, rejectTitleSnapshot:()=>proof.errors.push('title-rejected'),
          finishPrimaryAfterSnapshot:instance=>{
            proof.callbacks.push(instance.name);
            return valid() && !!approval && isInventoryCaptureName(instance.name,approval.name);
          },
          finishPairedContentAfterSnapshot:()=>{proof.errors.push('react-paired-body-callback');return false;},
        });
        function RoutedPrimary({route}) {
          return <RouteReady actorId="fictional" routeKey={route} contentIdentity={route}
            conventionalPrimary pairedInventory={paired && (!conventionalSource || route!==sourceRoute)} capture="regions">
            <InventoryCaptureRegion region="header">
              <header style={{height:90,background:route==='/inventory'?'#a33':'#33a'}}>
                {paired ? <ViewTransition default="none" name={approval?'primary-fixture-title':undefined}
                  share={valid()&&approval?'record-title':'none'} onShare={instance=>sharedTitleMotion(instance,valid)}>
                  <h1>{route}</h1>
                </ViewTransition> : <h1>{route}</h1>}
              </header>
            </InventoryCaptureRegion>
            <aside data-uncaptured-canvas><canvas width="20" height="20" /></aside>
            <InventoryCaptureRegion region="body">
              <section style={{height:240,background:'#777'}}><p>Fictional routed body</p></section>
            </InventoryCaptureRegion>
          </RouteReady>;
        }
        function OpaqueSlot({route}) {return <RoutedPrimary key={route} route={route}/>;}
        function App() {
          const [route,setRoute] = useState(sourceRoute);
          const [,render] = useState(0);
          state.policy = (full,admitted) => {
            enabled=full;privateReady=admitted;
            document.documentElement.dataset.motion=full?'full':'reduced';
            document.documentElement.dataset.routeMotionPrivate=String(admitted);
            flushSync(()=>render(n=>n+1));
          };
          state.begin = () => {
            approval={name:'route-primary-fixture',presentation:'primary',sourceKey:sourceRoute,destinationKey:destinationRoute,epoch:1};
            flushSync(()=>render(n=>n+1));
            if(paired && valid()) {
              const root=document.querySelector('[data-route-ready]');
              auxiliary.arm({token:approval,base:'primary-fixture-title-content',sourceKey:sourceRoute,destinationKey:destinationRoute,sourceRoot:root,
                handoff:()=>()=>proof.releaseCount++, admitted:valid,current:valid,participate:name=>{proof.auxiliaryNames.push(name);return true;}});
            }
            // No eligible outer/title fixture boundary exists in primary mode.
            startTransition(()=>setRoute(destinationRoute));
          };
          return <AuxiliaryRouteCaptureContext value={auxiliary}>
            <RoutePresentationSourceContext value={source}><OpaqueSlot route={route}/></RoutePresentationSourceContext>
          </AuxiliaryRouteCaptureContext>;
        }
        document.documentElement.dataset.motion='full';
        document.documentElement.dataset.routeMotionPrivate='true';
        createRoot(document.getElementById('root')).render(<App/>);
      `,
    },
    plugins: [
      {
        name: 'fixture-approval-only',
        setup(builder) {
          builder.onResolve({ filter: /^\.\/route-motion$/ }, () => ({
            path: 'fixture-motion',
            namespace: 'fixture-motion',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture-motion' }, () => ({
            contents:
              'export const useRouteMotion = () => window.routePrimary.motion();',
            loader: 'js',
          }));
        },
      },
    ],
    bundle: true,
    write: false,
    metafile: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: resolve('node_modules/next/dist/compiled/react'),
      'react-dom/client': resolve(
        'node_modules/next/dist/compiled/react-dom/client',
      ),
      'react-dom': resolve('node_modules/next/dist/compiled/react-dom'),
    },
  });
  return {
    script: result.outputFiles[0].text,
    inputs: Object.keys(result.metafile.inputs),
    sourceRoute,
    destinationRoute,
  };
}
