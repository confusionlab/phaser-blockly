/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as assistant from "../assistant.js";
import type * as costumeLibrary from "../costumeLibrary.js";
import type * as http from "../http.js";
import type * as objectLibrary from "../objectLibrary.js";
import type * as projectAssets from "../projectAssets.js";
import type * as projectEditorLeases from "../projectEditorLeases.js";
import type * as projects from "../projects.js";
import type * as soundLibrary from "../soundLibrary.js";
import type * as userSettings from "../userSettings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  assistant: typeof assistant;
  costumeLibrary: typeof costumeLibrary;
  http: typeof http;
  objectLibrary: typeof objectLibrary;
  projectAssets: typeof projectAssets;
  projectEditorLeases: typeof projectEditorLeases;
  projects: typeof projects;
  soundLibrary: typeof soundLibrary;
  userSettings: typeof userSettings;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
