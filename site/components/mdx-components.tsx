import defaultComponents from "fumadocs-ui/mdx";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import type { MDXComponents } from "mdx/types";
import { CreditsList } from "./credits-list";
import { FeatureList } from "./feature-list";
import { Shot } from "./shot";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultComponents,
    Tab,
    Tabs,
    Step,
    Steps,
    Shot,
    CreditsList,
    FeatureList,
    ...components,
  };
}
