export interface InstalledSkill {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly location: string;
  readonly basePath: string;
  readonly files: Readonly<Record<string, string>>;
  readonly sourceUrl?: string | undefined;
  readonly license?: string | undefined;
  readonly compatibility?: string | undefined;
  readonly metadata: Readonly<Record<string, string>>;
  readonly allowedTools?: string | undefined;
  readonly disableModelInvocation: boolean;
  /** Product-level skills that belong in every turn instead of loading on demand. */
  readonly alwaysApply: boolean;
}

export interface InstalledSkillSummary {
  readonly name: string;
  readonly description: string;
  readonly location: string;
  readonly sourceUrl?: string | undefined;
  readonly alwaysApply: boolean;
}
