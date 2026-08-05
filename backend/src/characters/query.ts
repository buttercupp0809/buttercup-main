// Re-export shim. The pure builder lives in @buttercupp/database so the frontend
// route handler can import it without crossing workspace boundaries. Backend
// callers get the same API via this file, matching the Phase 03 plan path.
export {
  buildCharacterWhere,
  buildCharacterOrderBy,
  viewerAllowsMature,
  VISITOR,
  type CharacterViewer,
  type CharacterOrderBy,
} from "@buttercupp/database";
