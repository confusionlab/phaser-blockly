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
import type * as costumeValidators from "../costumeValidators.js";
import type * as http from "../http.js";
import type * as libraryValidators from "../libraryValidators.js";
import type * as objectLibrary from "../objectLibrary.js";
import type * as projectAssets from "../projectAssets.js";
import type * as projectEditorLeases from "../projectEditorLeases.js";
import type * as projectExplorer from "../projectExplorer.js";
import type * as projects from "../projects.js";
import type * as sceneLibrary from "../sceneLibrary.js";
import type * as soundLibrary from "../soundLibrary.js";
import type * as templateLibrary from "../templateLibrary.js";
import type * as userSettings from "../userSettings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  assistant: typeof assistant;
  costumeLibrary: typeof costumeLibrary;
  costumeValidators: typeof costumeValidators;
  http: typeof http;
  libraryValidators: typeof libraryValidators;
  objectLibrary: typeof objectLibrary;
  projectAssets: typeof projectAssets;
  projectEditorLeases: typeof projectEditorLeases;
  projectExplorer: typeof projectExplorer;
  projects: typeof projects;
  sceneLibrary: typeof sceneLibrary;
  soundLibrary: typeof soundLibrary;
  templateLibrary: typeof templateLibrary;
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
