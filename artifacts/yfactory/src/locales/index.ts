import { registerLanguagePack } from '@/lib/languages';
import { deMeta, deResources } from './de';
import { faMeta, faResources } from './fa';
import { itMeta, itResources } from './it';
import { ptMeta, ptResources } from './pt';
import { ruMeta, ruResources } from './ru';
import { trMeta, trResources } from './tr';
import { urMeta, urResources } from './ur';

registerLanguagePack(deMeta, deResources);
registerLanguagePack(itMeta, itResources);
registerLanguagePack(ptMeta, ptResources);
registerLanguagePack(trMeta, trResources);
registerLanguagePack(ruMeta, ruResources);
registerLanguagePack(urMeta, urResources);
registerLanguagePack(faMeta, faResources);
