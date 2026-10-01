/**
 * `@aihu/agent-service` public surface (v0.3.0 live-dispatch).
 *
 * Value exports: `createAgentService`, and the GX Phase 2 principal gate:
 *               `resolvePrincipal`, `decideEmission`, `surfaceCallPolicy`,
 *               `isScopeValue`; the aihu#871 capability hook:
 *               `authorizeCapability`, `projectCapabilityResult`
 * Type exports: `AgentManifest`, `AgentToolEntry`, `AgentService`,
 *               `AgentServiceOptions`, `InputSchema`, `ActionSchema`,
 *               `LiveBinding`, `RequestContext`, `AuthPlugin`,
 *               `RateLimitPlugin`, `VerifiedClaims`, the principal-gate
 *               types (`Principal`, `EmissionDecision`, …), and the
 *               capability-gate types (`CapabilityAuthorizationVerdict`, …)
 */
export { createAgentService } from './agent-service.ts'
// aihu#871 — the capability authorization hook for per-resource data reads.
export type {
  CapabilityAuthorizationRequest,
  CapabilityAuthorizationVerdict,
  CapabilityDenyReason,
  CapabilityGrant,
  CapabilityGrantResolver,
  CapabilityProjection,
} from './capability-gate.ts'
export {
  authorizeCapability,
  projectCapabilityResult,
} from './capability-gate.ts'
// GX Phase 4 (#466) — the live-entitlement contract the call axis consults.
// The engine lives in `@aihu/server` (`createGovernedRegistry`); these types
// are the structural seam that keeps this package server-agnostic.
export type {
  EntitledPrincipal,
  EntitlementMemo,
  EntitlementsHandle,
  EntitlementVerdict,
} from './entitlements.ts'
export type {
  AnonymousPrincipal,
  AnonymousUaTier,
  CredentialFailure,
  EmissionDecision,
  EmissionDenyReason,
  EmissionDeps,
  EmissionQuery,
  EnforcementTier,
  ExtractCallValue,
  ExtractReadValue,
  ExtractScopeValue,
  HumanSessionPrincipal,
  Principal,
  PrincipalClass,
  PrincipalGateDeps,
  PrincipalSource,
  ScopedAgentPrincipal,
  VerifiedAgentPrincipal,
} from './principal-gate.ts'
export {
  decideEmission,
  isScopeValue,
  resolvePrincipal,
  surfaceCallPolicy,
} from './principal-gate.ts'
export type {
  ActionSchema,
  AgentManifest,
  AgentService,
  AgentServiceOptions,
  AgentToolEntry,
  AuthPlugin,
  InputSchema,
  LiveBinding,
  RateLimitPlugin,
  RequestContext,
  VerifiedClaims,
} from './types.ts'
