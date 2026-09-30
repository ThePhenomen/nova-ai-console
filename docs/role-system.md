# Ролевая система Nova AI Console

Документ описывает **текущую** реализацию: какие объекты задают доступ, как группы и ClusterRole влияют на Kubernetes и на экран, и по каким правилам консоль решает, что нарисовать конкретному пользователю.

Стек: React 18, PatternFly 6. Браузер не ходит в API server напрямую. Все вызовы идут через `/k8s-proxy/*` (`distributions/nova-ai/src/cluster/k8sClient.ts`, `distributions/nova-ai/config/k8sProxy.js`). Учётка транспорта — kubeconfig из `.env` (`KUBECONFIG_BASE64`). Запрос в кластер выполняется **от имени вошедшего пользователя**: proxy ставит `Impersonate-User` и `Impersonate-Group`.

Раздел §0 в `docs/deployments-and-settings.md` описывает старую модель (`consoleRole` из метки persona). Кнопки Projects / Roles / Permissions и видимость Settings считаются иначе; источник правды для ролей — этот файл.

Консоль видит только объекты с меткой `nova-ai.io/console=nova-ai-console` (`consoleScope.ts`). Проект = Namespace с этой меткой.

---

## 0. Из чего состоит доступ

Четыре разных вопроса, и на каждый отвечает свой объект.

| Вопрос | Объект | Что в нём |
|---|---|---|
| Кто этот человек в каталоге | `User` (`auth.nova-platform.io/v1alpha1`) | имя CR, username, entityId, email |
| В каких группах он состоит | `Group` | `spec.members` — имена User CR; `spec.type: internal` |
| Какие права и какой OIDC-клиент | `PlatformRole` | `spec.kubernetes.clusterRoleSelectors` и `spec.oidc.applications` |
| Кому и куда это выдано | `PlatformRoleBinding` | `subjects` + `kubernetes.target` |
| Сами правила API | `ClusterRole` | `rules` и labels, по которым PlatformRole его находит |

PlatformRole говорит **что**. PlatformRoleBinding говорит **кому и где**. Group говорит, **какие subject name** совпадут с человеком. ClusterRole хранит verbs/resources. Метка `nova-ai.io/console-persona` на PlatformRole кнопку сама не включает.

Оператор (вне этого репозитория) по PlatformRole собирает один агрегированный ClusterRole и пишет его имя в `status.aggregatedClusterRole`, список совпавших ролей — в `status.resolvedClusterRoles`. По PlatformRoleBinding он создаёт Kubernetes-привязку и OIDC assignment. Консоль эти status-поля читает, но права на экране считает сама, не дожидаясь формулировки «admin» от оператора.

### 0.1 `kubernetes.target`

Один биндинг имеет один target. Один PlatformRole нельзя одновременно привязать и к namespace, и ко всему кластеру: для этого заводят два биндинга (или две роли).

| `spec.kubernetes.target` | Что создаёт оператор | Что видит API |
|---|---|---|
| `Cluster` | ClusterRoleBinding `prb-<имя биндинга>` | И cluster-scoped rules, и namespaced rules. Namespaced rules при этом действуют **в каждом** namespace |
| `Namespaces` | RoleBinding в каждом namespace из `spec.kubernetes.namespaces` | Только namespaced rules. Cluster-scoped ресурсы RoleBinding не выдаёт |
| `None` | Kubernetes-привязки нет | Только OIDC assignment на приложения из PlatformRole |

`status.appliedTarget` — то, что оператор применил. Консоль смотрит сначала на него, потом на `spec.kubernetes`.

Почему KServe разрезан на четыре ClusterRole (`manifests/clusterroles.yaml`):

| ClusterRole | Label-селектор | Resources | Verbs |
|---|---|---|---|
| `nova-ai-aggregate-kserve-namespace-edit` | `nova-ai.io/aggregate-to-kserve-namespace-edit` | InferenceService, InferenceGraph, ServingRuntime, LLMInferenceService, … | `*` |
| `nova-ai-aggregate-kserve-namespace-view` | `…-namespace-view` | те же namespaced | `get`, `list`, `watch` |
| `nova-ai-aggregate-kserve-cluster-edit` | `…-cluster-edit` | ClusterServingRuntime, ClusterStorageContainer, LocalModelNodeGroup, LocalModelCache | `*` |
| `nova-ai-aggregate-kserve-cluster-view` | `…-cluster-view` | те же cluster | `get`, `list`, `watch` |

`nova-ai-kserve.ml-team.edit` выбирает только namespace-edit. Если привязать его с `target: Namespaces` и `namespaces: [ml-team]`, запись InferenceService есть в `ml-team`, cluster runtime не открывается. `nova-ai-kserve.cluster-view` / `cluster-edit` привязываются отдельно с `target: Cluster`. Иначе developer не смог бы читать ClusterServingRuntime: RoleBinding на это не способен, а ClusterRoleBinding роли с namespaced `*` открыл бы InferenceService во всех проектах.

Пустой `nova-ai-aggregate-component` (`rules: []`, label `nova-ai.io/aggregate-to-component`) нужен ролям, у которых есть только OIDC-клиент. Биндинг с `target: None` на такую роль Kubernetes-прав не добавляет.

### 0.2 Две проверки, которые консоль делает параллельно

Отрисовка и реальный допуск к API — разные механизмы. Оба должны сойтись, иначе кнопка есть, а POST возвращает 403, или API пускает, а пункт меню скрыт.

| Что решает | Откуда | Где используется |
|---|---|---|
| Какие проекты и вкладки показать | `computePlatformAccess` в `access.ts`: биндинги пользователя + rules ClusterRole + **имя группы** | sidebar, глобальный Project switcher, фильтр списка проектов, кнопки Create/Edit/Delete на Deployments |
| Можно ли нажать Create/Edit/Delete проекта, открыть Roles и Permissions, править Settings | `SelfSubjectAccessReview` (`canI` в `accessReview.ts`) от имени impersonated user | `useConsoleResourceAccess`, `KServeSettings`, вкладка Deployments внутри проекта |

Метка persona и имя роли в эту кнопку не входят. SSAR спрашивает apiserver: «этот user/group может `update` `platformroles`?». Ответ зависит от ClusterRoleBinding, который оператор уже создал.

---

## 1. Как запрос доходит до API server

### 1.1 Вход

Логин — OIDC StarVault (`oidcClient.ts`). В scope всегда входят `openid`, `email`, `profile`, `groups` плюс то, что задано в конфиге.

ID token проверяет `config/oidcIdentity.js`:

- username для Kubernetes — claim из `K8S_OIDC_USERNAME_CLAIM`, по умолчанию `sub`;
- `K8S_OIDC_USERNAME_PREFIX=-` означает **без префикса** (так же kube-apiserver трактует `-`);
- groups — `system:authenticated` плюс claim `groups` (или `nova_groups`, или `https://kubernetes.io/groups`);
- aliases для поиска человека: `sub`, username, `preferred_username`, `email`.

В API server уходит не ID token консоли как Bearer. Аудитория консольного клиента не совпадает с `--oidc-client-id` apiserver, такой Bearer получает Unauthorized. Proxy аутентифицируется kubeconfig и подставляет заголовки impersonation.

### 1.2 Impersonation

На каждый `/k8s-proxy/*` (`k8sProxy.js`):

1. Читается `X-Nova-Id-Token`.
2. Из токена берутся username и groups.
3. `groupsForIdentity` тем же kubeconfig (без impersonation) читает `users` и `groups` и добавляет имена Group CR, у которых `spec.members` совпал с alias или с именем User CR. Кэш 15 секунд.
4. В запрос ставятся `Impersonate-User: <username>` и `Impersonate-Group: <группы токена + имена Group CR>`.
5. Клиентские заголовки Impersonate-* из браузера не копируются.

Отдельный `GET /k8s-membership` возвращает `{ groups }` из того же lookup. `usePlatformAccess` мержит эти имена в `session.user.groups` **до** `computePlatformAccess`. Поэтому вкладка Experiments может открыться и тогда, когда claim `groups` в токене пустой, но Group CR уже содержит пользователя.

Учётка kubeconfig должна иметь право impersonate users и groups. Иначе весь proxy отвечает 403 независимо от PlatformRole.

### 1.3 Почему группа в токене и Group CR — не одно и то же

Оператор синхронизирует internal Group в identity-группу StarVault **с именем CR** (`nova-ai.admins`). Subject в сгенерированном ClusterRoleBinding — это имя группы `nova-ai.admins`.

Apiserver сопоставляет subject с `Impersonate-Group`. Имя попадает туда двумя путями:

- claim `groups` в ID token уже содержит `nova-ai.admins`;
- либо proxy нашёл Group CR, в `spec.members` которого есть User этого человека, и добавил имя CR сам.

Если человека добавили в Group CR, а lookup users/groups для kubeconfig запрещён и в токене группы нет, impersonation идёт без `nova-ai.admins`. ClusterRoleBinding на эту группу не срабатывает, SSAR возвращает `allowed: false`, кнопки гаснут. Повторный логин сам claim не создаёт: claim выдаёт identity provider.

---

## 2. Как консоль понимает, что рисовать

Загрузка одна на сессию (`usePlatformAccess.ts`). Ключ кэша — `sub` пользователя и наличие подключения к кластеру.

Параллельно:

| Запрос | Ошибка |
|---|---|
| `listPlatformRoles` | валит весь расчёт, access становится пустым |
| `listPlatformRoleBindings` | валит весь расчёт |
| `listPlatformUsers` | глотается как `[]` |
| `listPlatformGroups` | глотается как `[]` |
| `listClusterRoles` | глотается как `[]` |
| `GET /k8s-membership` | глотается как `[]` |

`listPlatformRoles` оставляет только роли, у которых в labels есть значение `nova-ai-console`.

Пустой список ClusterRole — частая причина «проектов нет». Без rules `consoleGrant.listNamespaces` остаётся false, `seesAllProjects` не включается. Список проектов при этом всё ещё может показаться, если SSAR `list namespaces` разрешён (см. §2.6): фильтр списка — это **или** SSAR, **или** `canViewProject`.

### 2.1 С кем совпал биндинг

`enrichUserFromPlatformDirectory` (`access.ts`) собирает aliases: `sub`, username, email, группы из токена, поля User CR (name, username, entityId, email, displayName) и имена Group CR, где пользователь в `spec.members` или имя группы уже есть среди aliases.

`bindingMatchesUser` истинен, если любой `spec.subjects[]` или `status.resolvedSubjects[]` совпал с этим множеством. Сравниваются полное значение и хвост после последнего `:`. ServiceAccount не совпадает никогда.

Дальше в расчёт попадают только биндинги этого пользователя, у которых `platformRoleRef.name` есть среди загруженных PlatformRole.

### 2.2 Что биндинг добавляет в расчёт

Для каждой такой пары binding+role консоль читает rules ClusterRole, чьи labels удовлетворяют **всем** `matchLabels` хотя бы одного `clusterRoleSelectors`.

Из rules собираются два гранта.

**Console grant** (`consoleGrantFromRules`):

| Поле | Условие в rules |
|---|---|
| `listNamespaces` | core group `""`, resource `namespaces`, verb `list` или `*` |
| `createNamespaces` | то же, verb `create` / `update` / `patch` / `delete` / `*` |
| `manageRbac` | group `auth.nova-platform.io`, resource `platformroles` или `platformrolebindings` (или subresource вроде `platformroles/status`), verb записи |

**KServe grant** (`kserveGrantFromRules`):

| Поле | Условие |
|---|---|
| `read` / `writeNamespaced` | `serving.kserve.io`, resource не из cluster-четвёрки (или `*`) |
| `readCluster` / `writeCluster` | resource из `clusterservingruntimes`, `clusterstoragecontainers`, `localmodelnodegroups`, `localmodelcaches` |

Cluster-часть kserve-гранта записывается только если в функцию передан scope `cluster`. Для биндинга с `target: Namespaces` консоль вызывает грант со scope `namespace`, поэтому cluster-read с такого биндинга в UI не попадает.

Дальше target:

**`Namespaces`**

- каждый namespace из списка попадает в `visibleProjects`;
- в проект копируются сервисы роли и, если есть namespaced read по `serving.kserve.io`, сервис `deployments`;
- namespaced write добавляет проект в `deploymentWriters` — от этого на Deployments включаются Create/Edit/Delete (`canEditDeployments`);
- `manageRbac` помечает проект в `projectRbacWriters`.

**`Cluster`**

- `listNamespaces` → `seesAllProjects` (в UI это «вижу все Nova-проекты», которые вернул `listProjects`);
- `createNamespaces` → `canCreateProjects` в объекте access (саму кнопку Create project включает SSAR, не это поле);
- `manageRbac` или `createNamespaces` поднимает глобальный `consoleRole` до `admin`; иначе берётся preset роли (см. §2.4);
- namespaced kserve read/write становятся cluster-wide: Deployments виден и редактируется во всех проектах, которые пользователь открывает;
- `readCluster` или `writeCluster` при target Cluster → `canViewKserveCluster`; только `writeCluster` → `canEditKserveCluster`.

**`None`**

Kubernetes-гранта нет. `servicesFromRole` всё равно дописывается в общий список сервисов. У ролей вроде `nova-ai-mlflow.ml-team` этот список пуст: вкладки Experiments / Pipelines / Workbench берутся из **имени группы**, не из OIDC application на роли.

### 2.3 Вкладки из имени группы

`componentServicesByNamespace` разбирает каждую группу пользователя регулярным выражением:

```
^nova-ai-(mlflow|airflow|jupyterhub)\.(.+)\.(admins|developers|viewers)$
```

| Группа | Сервис в проекте `<namespace>` |
|---|---|
| `nova-ai-mlflow.<namespace>.admins\|developers\|viewers` | Experiments |
| `nova-ai-airflow.<namespace>.admins\|developers\|viewers` | Pipelines |
| `nova-ai-jupyterhub.<namespace>.admins\|developers` | Workbench |
| `nova-ai-jupyterhub.<namespace>.viewers` | ничего; такой группы в манифестах нет |

`<namespace>` — всё между продуктом и уровнем, точки в имени проекта допустимы. Уровень — последний сегмент.

Имя проекта из группы добавляется в `visibleProjects`, даже если отдельного биндинга `nova-ai-developer` на этот namespace нет. Сервисы попадают в `forProject(name)` и, если проект виден, в глобальный список `access.services`.

Группы `nova-ai-console.*`, `nova-ai-kserve.*`, `nova-ai.admins` под этот regex не подходят. Deployments из имени группы не включается: его включают rules `serving.kserve.io`.

Метки `nova-ai.io/<tab>-enabled` и старая `nova-ai.io/console-service` ещё читаются в `servicesFromRole`, но значения `experiments`, `workbench`, `pipelines`, `deployments` из них выкидываются (`GROUP_GATED_SERVICES`). Эти четыре вкладки меткой PlatformRole больше не открываются.

### 2.4 Preset `consoleRole` и метка persona

`consoleRoleFromPlatformRole` всё ещё существует:

| Условие на PlatformRole | preset |
|---|---|
| label `nova-ai.io/console-persona: admin` или селектор `nova-ai.io/aggregate-to-admin: "true"` | `admin` |
| имя `nova-ai-developer` / `nova-ai-contributor` или селектор `aggregate-to-developer`, и это не admin | `contributor` |
| иначе | `none` |

Preset участвует в `forProject().role` и в тексте пустого списка проектов («No platform role assigned», когда `consoleRole === 'none'` и после фильтра строк нет). Кнопки Create project / Edit project / Delete project / Roles / Permissions на preset не смотрят.

`forProject(name).canView` истинен, когда role не `none` или у проекта есть хотя бы один сервис. `canEdit` истинен для `contributor` и `admin`. На Deployments используется отдельное поле `canEditDeployments` (kserve write), не `canEdit`.

### 2.5 Группа `nova-ai.admins`

Имя не матчится regex компонентов, поэтому в `computePlatformAccess` для неё есть отдельная ветка: если пользователь в группе `nova-ai.admins`, в проект `ml-team` добавляются сервисы `experiments`, `pipelines`, `workbench`, `deployments`, и `ml-team` попадает в `deploymentWriters`.

Это только вкладки в `ml-team`. Kubernetes-права этой группы задают биндинги, не эта ветка:

| Биндинг | Роль | Target |
|---|---|---|
| `nova-ai-admins-console` | `nova-ai-admin` | Cluster |
| `nova-ai-admins-kserve-cluster-edit` | `nova-ai-kserve.cluster-edit` | Cluster |
| `nova-ai-admins-kserve-edit` | `nova-ai-kserve.ml-team.edit` | Cluster |
| `nova-ai-admins-mlflow` / `-airflow` / `-jupyterhub` | instance-роль компонента | None |

Target Cluster на `nova-ai-kserve.ml-team.edit` специально даёт namespaced `*` на InferenceService **во всех** namespace. У групповых биндингов `nova-ai-kserve.ml-team.admins` тот же edit-роль висит с `target: Namespaces` и списком `[ml-team]`.

Член группы в манифесте один: User `ml-admin`.

### 2.6 Sidebar и выбранный проект

`AuthToolbarItem` на каждое изменение access и выбранного проекта ставит feature flags:

| Flag | Когда true |
|---|---|
| `workbench`, `experiments`, `pipelines`, `deployments` | у **выбранного** проекта `hasProjectService` для этого сервиса |
| `kserve-settings` | `canViewKserveCluster` **или** у выбранного проекта есть сервис Deployments |

`extensions.ts` вешает `flags.required` на пункты sidebar и маршруты. Projects (`/projects`) флага не имеет и виден всегда после входа. Пустая секция Settings скрывается, когда единственный ребёнок KServe выключен флагом.

Выбранный проект живёт в `sessionStorage` (`nova-ai.selectedProject`) и в шапке (`ProjectSwitcher`). Смена проекта пересчитывает флаги: Experiments в `ml-team` не означает Experiments в другом проекте.

`ProjectSwitcher`, если открыт Workbench / Experiments / Pipelines / Deployments / Settings, а для нового проекта флаг погас, уводит на `/projects/<name>/overview`.

`canShowKserveSettings` поэтому зависит от выбранного проекта. Пользователь только с `nova-ai-kserve.ml-team.view` видит Settings, пока выбран `ml-team` (есть Deployments). Пользователь с `nova-ai-kserve.cluster-view` (target Cluster) видит Settings при любом выбранном проекте. Кнопки Create/Edit на Settings всё равно идут через SSAR и у view-роли останутся выключены.

### 2.7 SelfSubjectAccessReview

`canI(verb, group, resource, namespace?)` делает `POST /apis/authorization.k8s.io/v1/selfsubjectaccessreviews`. Ошибка запроса считается как `allowed: false`.

`useConsoleResourceAccess` один раз на монтирование проверяет:

| Поле | Запрос |
|---|---|
| `listNamespaces` | `list` core `namespaces` |
| `createNamespaces` | `create` |
| `updateNamespaces` | `update` |
| `deleteNamespaces` | `delete` |
| `manageRoles` | `update` на `platformroles` **или** `update` на `platformrolebindings` (`auth.nova-platform.io`) |

Это включает:

- кнопку **Create project** и пункт меню, если список пуст;
- kebab **Edit project** / **Delete project** / **Edit permissions** на строке проекта;
- вкладки **Roles** и **Permissions** внутри проекта;
- блок Project configuration на Overview.

`nova-ai-aggregate-admin` даёт все эти verbs и `*` на platformroles/platformrolebindings, плюс `get/list/watch` на groups, users и `rbac.authorization.k8s.io/clusterroles` — последнее нужно, чтобы `listClusterRoles` не был пустым и расчёт вкладок увидел rules.

`nova-ai-aggregate-developer` даёт на namespaces только `get`, на resourcequotas `get/list/watch`. Create project, правка namespace, Roles и Permissions у developer выключены. `list namespaces` у него нет, поэтому чужие проекты в список не попадают, если их нет в `visibleProjects`.

Вкладка Deployments внутри проекта видна, если SSAR `list inferenceservices` в этом namespace **или** `hasProjectService(..., 'Deployments')`. Кнопки Create/Edit/Delete на самой странице Deployments смотрят на `canEditDeployments` из расчёта rules, не на отдельный SSAR.

Settings/KServe на каждую вкладку делает свой `canI`: cluster kind — `create`/`update` без namespace; ServingRuntime — по каждому видимому namespace. Объект с label `nova-ai.io/pre-installed: "true"` в UI не редактируется даже при `update: true`.

### 2.8 Что на экране у типичных групп `ml-team`

Манифесты: `groups.yaml`, `platformroles.yaml`, `platformrolebindings.yaml`. Уровни admins/developers/viewers — это **разные группы на одну и ту же instance-роль** компонента. Отдельных PlatformRole «mlflow admin» и «mlflow viewer» нет: OIDC-клиент один (`nova-ai-mlflow-ml-team`), уровень записан в имени группы.

| Группа | PlatformRole | Target | Что открывается в консоли |
|---|---|---|---|
| `nova-ai.admins` | admin + kserve cluster-edit + ml-team.edit + три OIDC-роли | Cluster / Cluster / Cluster / None | все проекты, Create project, Roles, Permissions, Deployments везде, Settings с записью cluster, в `ml-team` ещё Experiments, Pipelines, Workbench |
| `nova-ai-console.admins` | `nova-ai-admin` | Cluster | те же кнопки проектов и ролей; компонентные вкладки и Deployments сами по себе не появляются |
| `nova-ai-console.ml-team.developers` | `nova-ai-developer` | Namespaces `[ml-team]` | проект `ml-team` виден; Create/Roles/Permissions нет; Experiments/Pipelines/Workbench/Deployments нет |
| `nova-ai-kserve.ml-team.admins` | `cluster-edit` + `ml-team.edit` | Cluster + Namespaces `[ml-team]` | Deployments в `ml-team` с записью, Settings cluster с записью |
| `nova-ai-kserve.ml-team.developers` | `ml-team.edit` + `cluster-view` | Namespaces `[ml-team]` + Cluster | Deployments в `ml-team` с записью, Settings cluster только просмотр |
| `nova-ai-kserve.ml-team.viewers` | `ml-team.view` + `cluster-view` | Namespaces `[ml-team]` + Cluster | Deployments в `ml-team` без записи, Settings cluster только просмотр |
| `nova-ai-mlflow.ml-team.*` | `nova-ai-mlflow.ml-team` | None | Experiments в `ml-team`; Kubernetes-прав нет |
| `nova-ai-airflow.ml-team.*` | `nova-ai-airflow.ml-team` | None | Pipelines в `ml-team` |
| `nova-ai-jupyterhub.ml-team.admins\|developers` | `nova-ai-jupyterhub.ml-team` | None | Workbench в `ml-team` |

Человек может состоять в нескольких группах. Сервисы и гранты складываются. `maxRole` оставляет более сильную console-роль (`admin` > `contributor` > `none`).

---

## 3. Цепочка от логина до пункта меню

```
ID token
  username = sub (prefix "-" выключен)
  groups   = claim groups + system:authenticated
        │
        ▼
Proxy: kubeconfig + Impersonate-User / Impersonate-Group
  Group CR spec.members дополняет Impersonate-Group
        │
        ├─ SSAR list/create/update/delete namespaces
        │    update platformroles | platformrolebindings
        │         → кнопки проекта, вкладки Roles и Permissions
        │
        └─ list PlatformRole, PlatformRoleBinding, User, Group, ClusterRole
                 + GET /k8s-membership
                 │
                 ▼
           computePlatformAccess
             binding совпал с user?
               target Namespaces → проект в visibleProjects, deployments по rules
               target Cluster    → seesAllProjects / kserve cluster / consoleRole
               target None       → OIDC, без k8s-прав
             имя группы nova-ai-<product>.<ns>.<level>
               → Experiments | Pipelines | Workbench в этом ns
             группа nova-ai.admins
               → те же вкладки в ml-team
                 │
                 ▼
           выбранный проект (sessionStorage)
             forProject(name).services → flags sidebar
             canViewKserveCluster или Deployments в проекте → Settings
```

Пустой экран «No projects are visible for your PlatformRoleBinding» значит: `listProjects` что-то вернул, но ни SSAR `list namespaces`, ни `canViewProject` строку не пропустили. Это не 403 на list: 403 рисуется как «Could not load projects».

---

## 4. Сценарии

1. **Пользователь в `nova-ai-console.admins`, биндинг Ready, target Cluster.** SSAR разрешает list/create/update/delete namespaces и update platformroles. В списке все Nova-проекты, есть Create project, внутри проекта есть Roles и Permissions. Experiments нет, пока его нет в `nova-ai-mlflow.<ns>.*` или в `nova-ai.admins`.
2. **Тот же человек, но claim `groups` пуст и kubeconfig не может list Group.** Impersonate-Group без `nova-ai-console.admins`. SSAR false, кнопок нет. Если ClusterRole при этом не прочитался, `seesAllProjects` тоже false.
3. **Только `nova-ai-mlflow.ml-team.developers`.** Проект `ml-team` появляется из имени группы. Внутри — Overview и Experiments. Sidebar Experiments есть, пока выбран `ml-team`. Create project нет.
4. **`nova-ai-kserve.ml-team.developers`.** В `ml-team` есть Deployments, Create/Edit/Delete моделей включены (`namespace-edit`). Settings виден. ClusterServingRuntime открывается на чтение (`cluster-view`), Create на cluster-вкладке нет.
5. **`nova-ai-kserve.ml-team.viewers`.** Список Deployments есть, кнопки записи выключены. Cluster Settings тоже только чтение.
6. **`nova-ai.admins` / `ml-admin`.** Cluster admin + kserve edit везде + вкладки компонентов в `ml-team`. Другие проекты своих OIDC-клиентов из этих манифестов не получают: для них нужны свои `nova-ai-<component>.<другой-ns>` и группы.
7. **Смена проекта в шапке.** Флаги пересчитываются. Открытый `/experiments` при проекте без Experiments заменяется на Overview нового проекта.
8. **Роль с селектором есть, ClusterRole с таким label не применён.** Грант пустой. Вкладка из rules не появится, SSAR останется false, даже если PlatformRole в статусе Ready.
9. **Биндинг `nova-ai-kserve.ml-team.edit` с target Cluster.** Write на InferenceService во всех namespace, не только в `ml-team`. Так сделано только у `nova-ai.admins`.
10. **JupyterHub viewers.** Группа не заведена, regex для `jupyterhub` + `viewers` сервис не добавляет.

---

## 5. Карта кода

| Задача | Куда смотреть |
|---|---|
| Расчёт вкладок и видимых проектов | `src/auth/access.ts` `computePlatformAccess` |
| Загрузка ролей и membership | `src/auth/usePlatformAccess.ts` |
| Кнопки проекта и вкладки Roles/Permissions | `src/auth/useConsoleResourceAccess.ts`, `src/cluster/accessReview.ts` |
| Impersonation и `/k8s-membership` | `config/k8sProxy.js`, `config/oidcIdentity.js` |
| Feature flags sidebar | `src/auth/AuthToolbarItem.tsx`, `src/extensions.ts` |
| Уход со скрытой вкладки при смене проекта | `src/pages/projects/ProjectSwitcher.tsx` |
| Поставляемые роли | `manifests/clusterroles.yaml`, `platformroles.yaml`, `groups.yaml`, `platformrolebindings.yaml` |
| Кто может жать Create на Deployments | `DeploymentsPage.tsx` `canEditDeployments` |
| Кто может жать Create в Settings | `KServeSettings.tsx` `canI` |

---

## 6. Ограничения текущей реализации

- Вкладки Experiments, Pipelines и Workbench завязаны на **имя** Group CR. Биндинг на OIDC-роль без группы нужного имени вкладку не откроет.
- `nova-ai.admins` открывает компонентные вкладки только в namespace `ml-team`.
- Список ClusterRole, users и groups при 403 превращается в пустой массив. Расчёт rules тогда пустой; SSAR при этом может быть успешным, и кнопки проекта всё равно появятся.
- `canCreateProjects` и `consoleRole` в объекте access не включают кнопки. Кнопки включает SSAR.
- Метка `nova-ai.io/console-persona` влияет только на preset `consoleRole`, не на RBAC.
- Один биндинг — один target. Cluster read и namespace write — разные PlatformRole.
- Apply манифеста не удаляет переименованные объекты. Старые PlatformRole и биндинги нужно удалять отдельно.
- Proxy не шлёт ID token консоли как kube Bearer. Права пользователя появляются только через impersonation, а для неё kubeconfig должен иметь `impersonate`.
