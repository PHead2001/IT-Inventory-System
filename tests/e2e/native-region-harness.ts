import { build } from 'esbuild';
import { resolve } from 'node:path';

type StableTopology =
  'keyed template' | 'retained Activity' | 'delayed Suspense';
/** Production capture/Slot/lifetime, with controlled registry arming. This is
 * deliberately separate from the actual Link/RSC/privacy navigation journeys. */
export async function stableRegionHarness(
  topology: StableTopology,
  reverse: boolean,
  productionHeader = true,
  authoredBody: 'paired' | 'offscreen-source' | null = null,
) {
  const result = await build({
    stdin: {
      contents: `
        import React, {Activity, Suspense, use, useContext, useEffect, useRef, startTransition, useState, ViewTransition} from 'react';
        import {createRoot} from 'react-dom/client';
        import {RouteMotionProvider, useRouteMotion} from './src/components/experience/route-motion';
        import {MotionPreference} from './src/components/experience/motion-preference';
        import {PageArrival} from './src/components/experience/page-arrival';
        import {RouteReady} from './src/components/experience/route-ready';
        import {InventoryCaptureRegion} from './src/components/experience/inventory-capture-region';
        import {AuxiliaryRouteCaptureContext} from './src/components/experience/auxiliary-route-context';
        import {RoutePresentationLifetimeContext} from './src/components/experience/route-presentation-source';
        import {PrivacyReadinessContext} from './src/components/auth/privacy-readiness';
        import {assignmentEpoch, readPrivacyRevocationRevision} from './src/features/scan/assign-batch';
        const proof = {old:[], next:[], effects:[], ready:false, finished:false, error:null};
        let resolveGate;
        const gate = new Promise(resolve => {resolveGate = resolve;});
        const capture = () => Array.from(document.querySelectorAll('[data-region]')).map(element => {
          const {x,y,width,height} = element.getBoundingClientRect();
          const canvasAncestors = [];
          for (const canvas of element.querySelectorAll('canvas')) {
            for (let ancestor = canvas; ancestor; ancestor = ancestor.parentElement) {
              const name = getComputedStyle(ancestor).viewTransitionName;
              if (name && name !== 'none') canvasAncestors.push(name);
            }
          }
          return {region:element.dataset.region, name:getComputedStyle(element).viewTransitionName,
            bounds:{x,y,width,height}, viewport:{width:innerWidth,height:innerHeight},canvasAncestors};
        });
        const native = document.startViewTransition.bind(document);
        document.startViewTransition = options => {
          proof.old = capture();
          const update = typeof options === 'function' ? options : options.update;
          const wrapped = async () => {await update(); proof.next = capture();};
          const transition = native(typeof options === 'function' ? wrapped : {...options,update:wrapped});
          const sample = () => {
            for (const animation of document.getAnimations()) {
              const pseudo = animation.effect?.pseudoElement;
              if (pseudo?.startsWith('::view-transition') && !proof.effects.includes(pseudo)) proof.effects.push(pseudo);
            }
            if (!proof.finished) requestAnimationFrame(sample);
          };
          transition.ready.then(() => {proof.ready = true; sample();}, error => {proof.error = error.name;});
          transition.finished.then(() => {proof.finished = true;}, error => {proof.error = error.name; proof.finished = true;});
          return transition;
        };
        function Page({step}) {
          if (${topology === 'delayed Suspense'} && step === 1) use(gate);
          const title = <ViewTransition name="stable-title" default="none" update="none" share="fixture-region">
            <h1 data-region="title">{step ? 'Record details' : 'Inventory'}</h1>
          </ViewTransition>;
          const heading = <header data-region="header">{title}<p>Visible route summary</p></header>;
          return <RouteReady actorId="fixture-actor" routeKey={pathFor(step)} contentIdentity={'page-'+step} pairedInventory conventionalPrimary capture="regions"><main data-fixture-step={step}>
            {step === 1 ? ${productionHeader ? '<InventoryCaptureRegion region="header">{heading}</InventoryCaptureRegion>' : '<ViewTransition name="stable-header" default="none" update="none" share="fixture-region" enter="fixture-region" exit="fixture-region">{heading}</ViewTransition>'} : heading}
            ${authoredBody ? '<InventoryCaptureRegion region="body">' : '<ViewTransition name="stable-body" default="none" update="none" share="fixture-region" enter="fixture-region" exit="fixture-region">'}
              <section data-region="body" style={{marginTop:${authoredBody === 'offscreen-source' ? 'step === 0 ? 1100 : 0' : '0'}}}><p>{step ? 'Item details: manufacturer and description' : 'Matching inventory records'}</p><button>Ordinary action</button></section>
            ${authoredBody ? '</InventoryCaptureRegion>' : '</ViewTransition>'}
            <div data-region="canvas-slot"><canvas aria-label="Map excluded from capture" width="200" height="60" /></div>
          </main></RouteReady>;
        }
        const pathFor = step => step ? '/inventory/quantity/native-fixture' : '/inventory';
        window.fixturePath = pathFor(${reverse ? 1 : 0});
        function App() {
          const [step,setStep] = useState(${reverse ? 1 : 0});
          window.fixturePath = pathFor(step);
          return <MotionPreference><PrivacyReadinessContext value={{ready:true,visible:true,generation:'native-fixture',revocationRevision:readPrivacyRevocationRevision(),verifiedEpoch:assignmentEpoch()}}>
            <RouteMotionProvider actorId="fixture-actor"><Journey step={step} setStep={setStep}/></RouteMotionProvider>
          </PrivacyReadinessContext></MotionPreference>;
        }
        function Journey({step,setStep}) {
          const motion = useRouteMotion();
          const registry = useContext(AuxiliaryRouteCaptureContext);
          const lifetime = useContext(RoutePresentationLifetimeContext);
          const host = useRef(null);
          window.regionHarness = {proof, release:resolveGate, transition:() => {
            const sourceKey = pathFor(step), destinationKey = pathFor(1-step);
            const sourceRoot = host.current.querySelector('[data-fixture-step="'+step+'"]').parentElement;
            const source = registry.source(sourceRoot, sourceKey);
            if (${productionHeader} && (!motion.validNow() || !source || !registry.arm({
              token:{},base:'${authoredBody ? 'stable-body' : 'stable'}',sourceKey,destinationKey,sourceRoot,
              handoff:lifetime.exitCallback(source),current:motion.validNow,
              admitted:motion.validNow,participate:() => true,
            }))) throw new Error('Production header admission unavailable');
            startTransition(() => setStep(n => 1-n));
          }};
          useEffect(() => { const frame = requestAnimationFrame(() => { host.current.dataset.admitted = String(motion.validNow()); }); return () => cancelAnimationFrame(frame); });
          const pages = ${topology === 'retained Activity' ? '[0,1].map(page => <Activity key={page} mode={page === step ? "visible" : "hidden"}><Page step={page}/></Activity>)' : '<Page key={step} step={step}/>'};
          return <div id="privacy" ref={host}><Suspense fallback={<p>Loading destination</p>}>
            <PageArrival pathname={pathFor(step)}>{pages}</PageArrival>
          </Suspense></div>;
        }
        createRoot(document.getElementById('root')).render(<App/>);
      `,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    outfile: 'native-region-harness.js',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'native-capture-platform-adapters',
        setup(builder) {
          builder.onResolve(
            { filter: /^(next\/navigation|@\/lib\/supabase\/browser)$/ },
            ({ path }) => ({ path, namespace: 'native-platform' }),
          );
          builder.onLoad(
            { filter: /.*/, namespace: 'native-platform' },
            ({ path }) => ({
              contents:
                path === 'next/navigation'
                  ? `export const usePathname = () => window.fixturePath;
               export const useSearchParams = () => new URLSearchParams();
               export const useRouter = () => ({push(){},replace(){},refresh(){}});`
                  : `export const createSupabaseBrowserClient = () => ({auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}}});`,
              loader: 'js',
            }),
          );
        },
      },
    ],
    alias: {
      react: resolve('node_modules/next/dist/compiled/react'),
      'react-dom/client': resolve(
        'node_modules/next/dist/compiled/react-dom/client',
      ),
      'react-dom': resolve('node_modules/next/dist/compiled/react-dom'),
    },
  });
  return result.outputFiles[0].text;
}
