# Projects — функциональные требования и детали реализации

Документ описывает **текущую** реализацию раздела **Projects**: список, шапка с выбором проекта, карточка проекта и вкладки Overview, Workbench, Experiments, Pipelines, Deployments, Roles, Permissions.

Кто вообще видит проект и вкладку, считается в `docs/role-system.md`. Здесь — что нарисовано на экранах Projects и какие запросы они делают.

Стек: React 18, PatternFly 6. Запросы к кластеру идут через `/k8s-proxy/*`. Проект = Namespace с меткой `nova-ai.io/console=nova-ai-console` (`consoleScope.ts`). Системные namespace с префиксом `kube-` и `openshift-` в список не попадают, даже если метка на них есть.

Сначала связи (**§0**), обход экранов (**§A**), затем список (**§1**), шапка (**§2**), карточка и вкладки (**§3–§6**).

---

## 0. Что с чем связано

Открытие проекта в списке записывает его имя в глобальный выбор (`sessionStorage`, ключ `nova-ai.selectedProject`). Sidebar Workbench / Experiments / Deployments и пункт Settings → KServe смотрят на **этот** проект, не на проект, который просто мелькнул в таблице.

| Экран | URL | От чего зависит видимость |
|---|---|---|
| Список | `/projects` | пункт sidebar всегда; строки — SSAR `list namespaces` **или** `canViewProject` |
| Карточка | `/projects/:name/:tab` | тот же фильтр, иначе Alert «Access denied» |
| Overview | `…/overview` | проект доступен |
| Workbench / Experiments / Pipelines | `…/workbench` и т.д. | сервис есть в `forProject(name)` (имя группы, см. role-system) |
| Deployments внутри проекта | `…/deployments` | SSAR `list inferenceservices` в этом namespace **или** сервис Deployments |
| Roles / Permissions | `…/roles`, `…/permissions` | SSAR `update` на `platformroles` или `platformrolebindings` |
| Карточка модели из проекта | `/projects/:name/deployments/:kind/:name` | маршрут Projects, страница `DeploymentDetails` |

Вкладки Workbench, Experiments и Pipelines внутри проекта сейчас заглушки (`PlaceholderTab`). Рабочий список моделей — Deployments. Pipelines в sidebar нет: это только вкладка проекта.

Кнопки списка (Create / Edit / Delete project, Edit permissions) и вкладки Roles / Permissions включаются одним хуком `useConsoleResourceAccess` и **не** смотрят на метку persona.

---

## A. Что происходит на экранах Projects

### A.1 Список (`/projects`)

Все Nova-проекты, которые этот пользователь имеет право видеть. Одна строка = один Namespace.

**Что происходит при входе**

1. Без kubeconfig в `.env` — empty state «Cluster kubeconfig is not configured», запросов нет.
2. Без сессии — info «Sign in required». List всё равно пытается уйти в proxy и получит 401, пока нет ID token.
3. `listProjects()`: `GET /api/v1/namespaces` и `GET /api/v1/resourcequotas`. Квоты при ошибке дают пустой список, namespace-запрос при ошибке роняет страницу в Alert.
4. Строка остаётся, если SSAR разрешил `list namespaces` **или** `access.canViewProject(name)`.
5. Поиск, сортировка и пагинация — на клиенте, по уже отфильтрованному списку.

**Что нарисовано**

- Поиск «Filter by name» (имя, описание, phase).
- **Create project** — только если SSAR `create namespaces`.
- **Refresh**.
- Пагинация 10 / 20 / 50 / 100, по умолчанию 10, сортировка name asc.
- Колонки: Name, Description, Status, Resource quota, Created, kebab.
- Description — аннотация `nova-ai.io/description`, иначе `kubernetes.io/description`.
- Resource quota — пары `key: value` из `status.hard` или `spec.hard` квоты `nova-ai-quota` (если её нет — любая квота namespace). Пусто → `—`.
- Клик по строке открывает `/projects/<name>/overview` и тем самым делает этот проект выбранным в шапке.

**Kebab строки**

Появляется, если есть хотя бы одно из прав create / update / delete namespaces или `manageRoles`.

| Пункт | Когда активен | Куда ведёт |
|---|---|---|
| Edit project | SSAR `update namespaces` | модалка правки описания и квоты, имя заблокировано |
| Edit permissions | `manageRoles` | `/projects/<name>/permissions` |
| Delete project | SSAR `delete namespaces` | confirm, затем `DELETE /api/v1/namespaces/<name>` |

Create виден в toolbar, в kebab его нет.

**Пустые состояния**

| Условие | Текст |
|---|---|
| `consoleRole === 'none'`, ошибок загрузки ролей нет, после фильтра строк 0 | info «No platform role assigned» и подсказка привязать User или Group к `nova-ai-admin` / `nova-ai-developer` |
| list вернул объекты, фильтр всё выкинул, create нет | «No projects are visible for your PlatformRoleBinding.» |
| list вернул объекты, фильтр всё выкинул, create есть | «Create a project…» и кнопка |
| поиск ничего не нашёл | «No projects match the current filter.» |
| `listProjects` бросил ошибку | Alert «Could not load projects» |

Сообщение про PlatformRoleBinding — это пустой фильтр, не 403. 403 на `GET namespaces` показывается как «Could not load projects».

### A.2 Модалка Create / Edit project

Поля: Name, Description, CPU request/limit, Memory request/limit, Pods, список ускорителей (resource + quantity, например `nvidia.com/gpu`).

Дефолты создания: CPU request `2` / limit `4`, memory `4Gi` / `8Gi`, pods `20`, одна пустая строка ускорителя.

**Create**

1. Имя обязано матчить `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`, длина 1–63. Точки в имени проекта форма не принимает.
2. Хотя бы одно поле квоты непустое.
3. `POST /api/v1/namespaces` с label `nova-ai.io/console=nova-ai-console` и аннотацией описания, если она задана.
4. `POST …/namespaces/<name>/resourcequotas` с именем `nova-ai-quota` и `spec.hard`.
5. Если квота не создалась, namespace удаляется.
6. Успех закрывает модалку и открывает Overview нового проекта.

**Edit** пишет описание в аннотацию namespace (`PUT` всего Namespace) и обновляет существующую квоту `nova-ai-quota` или первую найденную. Если квоты не было — создаёт `nova-ai-quota`. Имя проекта не меняется.

### A.3 Выбор проекта в шапке

`ProjectSwitcher` рисуется в masthead. Подпись **Project** и `FormSelect`.

Список опций — те же имена, что проходят фильтр списка (`list namespaces` или `canViewProject`), по алфавиту.

Пока грузится — spinner. Если имён нет — select disabled, подпись «No projects», выбранный проект сбрасывается.

Откуда берётся значение:

1. Если URL вида `/projects/<name>/…` и это имя есть в списке — выбирается оно.
2. Иначе, если сохранённое имя ещё в списке, оно остаётся.
3. Иначе берётся первое имя по алфавиту.

Выбор другого проекта, когда пользователь уже внутри `/projects/<old>/…`, переходит на `/projects/<new>/<тот же хвост>`. На `/projects` смена select только меняет глобальный выбор и флаги sidebar, маршрут списка не трогает.

Если при выбранном проекте открыты `/workbench`, `/experiments`, `/deployments` или `/settings`, а для этого проекта сервис скрыт, switcher делает `replace` на `/projects/<name>/overview`.

### A.4 Карточка проекта

Хлебные крошки Projects → имя, заголовок = имя namespace. Под ними вкладки. Активная вкладка — сегмент URL. Неизвестный сегмент и вкладка, которой у пользователя нет, заменяются на `overview`.

**Кто какую вкладку видит**

| Вкладка | Условие |
|---|---|
| Overview | SSAR `list namespaces` **или** `forProject(name).canView` |
| Workbench | в сервисах проекта есть Workbench |
| Experiments | есть Experiments |
| Pipelines | есть Pipelines |
| Deployments | SSAR `list` `serving.kserve.io/inferenceservices` в этом namespace **или** сервис Deployments |
| Roles | `manageRoles` |
| Permissions | `manageRoles` |

Если нет ни `list namespaces`, ни `canViewProject(name)`, вместо вкладок Alert «Access denied» / «Your PlatformRoleBinding does not grant access to this project.»

Overview при `list namespaces` виден даже когда `forProject` пустой: admin с cluster list открывает любой Nova-проект из таблицы.

### A.5 Overview

`GET namespace` и `GET resourcequotas` этого namespace. Namespace без метки консоли — Alert «This namespace is not a Nova AI Console project.»

Карточка Details: Name, Description, Status (`status.phase`), Created.

Карточка Resource quotas: по каждой квоте таблица Resource / Used / Hard limit. Нет квот — текст «No resource quota is set on this project.»

Если `manageRoles`, снизу раскрытый блок **Project configuration**:

- **Roles** → `/projects/<name>/roles`
- **Permissions** → `/projects/<name>/permissions`
- **MLCluster** — внешняя ссылка, только если задан URL в env (`getCreateMlClusterUrl`). Без URL карточки нет.

### A.6 Roles

Таблица PlatformRole с меткой консоли. Колонки: Name, ClusterRole, OIDC applications, Phase, Bound here, kebab.

ClusterRole в ячейке: `status.resolvedClusterRoles`, а если статус ещё пуст — `status.aggregatedClusterRole`. Это имена, которые собрал оператор, не селекторы.

OIDC applications — `spec.oidc.applications` чипами. `nova-ai-console` синий, остальные серые. На таблице приложения только читаются.

**Bound here**

Yes, если есть PlatformRoleBinding на эту роль и `bindingAppliesToProject`:

- target `Cluster`, или
- target `Namespaces` и в списке есть этот проект, или
- target `None`, но имя роли матчится `nova-ai-(mlflow|airflow|jupyterhub).<namespace>` и этот namespace равен открытому проекту.

Знак вопроса рядом с заголовком: Yes — биндинг роли действует на этот проект; No — роль есть, здесь она не выдана, выдать можно на Permissions.

**Create platform role** и kebab **Edit** открывают одну модалку.

Форма:

- Name. При создании приводится к lower case и должно матчить `^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$` (точки в имени роли допустимы). При edit имя заблокировано.
- ClusterRole selectors. Пара key/value, кнопка Add. Каждая пара становится отдельным `{ matchLabels: { key: value } }`. Пока Add не нажат, черновик в spec не входит.
- OIDC applications. Имя `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`. `nova-ai-console` само не подставляется.

Нужен хотя бы один селектор или одно приложение. Create пишет label `nova-ai.io/console=nova-ai-console` и не ставит persona. Edit заменяет `spec.kubernetes` и `spec.oidc`: пустая сторона уходит как `undefined`.

Kebab **Delete** открывает confirm и делает `DELETE /apis/auth.nova-platform.io/v1alpha1/platformroles/<name>`. Биндинги, которые ещё ссылаются на роль, консоль сама не снимает: API вернёт ошибку в этой модалке, если удаление отклонено.

Текст над таблицей напоминает схему имён: консольный логин остаётся на `nova-ai-admin` и `nova-ai-developer`; instance-роль вроде `nova-ai-jupyterhub.team-a` содержит только свой OIDC-клиент; группы admins/developers биндятся на неё; у MLflow и Airflow есть ещё viewers.

### A.7 Permissions

Таблица биндингов, у которых роль входит в консольные PlatformRole **и** `bindingAppliesToProject` для открытого проекта. Колонки: Binding, Role, Subjects, Target, Phase, kebab.

Target в ячейке: `status.appliedTarget`, иначе `spec.kubernetes`. Для Namespaces в скобках список namespace.

**Grant access** — модалка:

- Subject: User или Group, имя строкой.
- PlatformRole: выпадающий список консольных ролей.

Сохранение создаёт PlatformRoleBinding:

- имя `dns1123Name("<project>-<subject>-<role>")` — нижний регистр, всё кроме `[a-z0-9-]` становится `-`, точки тоже;
- labels консоли;
- аннотация `nova-ai.io/granted-in-project: <текущий проект>`;
- subject как ввели;
- kubernetes:
  - если у роли label `nova-ai.io/kubernetes-target: Cluster` — target `Cluster`;
  - иначе, если у роли есть `clusterRoleSelectors` — target `Namespaces` и `namespaces: [<текущий проект>]`;
  - иначе target `None`.

Роли `nova-ai-kserve.cluster-edit` и `nova-ai-kserve.cluster-view` в манифесте помечены `nova-ai.io/kubernetes-target: Cluster`, поэтому Grant выдаёт их на весь кластер. `nova-ai-mlflow.ml-team` селекторов не имеет, Grant создаёт target `None`.

**Revoke** в kebab активен только если аннотация `nova-ai.io/granted-in-project` **равна имени открытого проекта**. Grant access пишет её сам. Биндинги из `platformrolebindings.yaml` этой аннотации не имеют, пункт серый. Консоль не отличает «создан из манифеста» никаким другим признаком: совпала аннотация — Revoke можно нажать. Снять такой биндинг можно `kubectl delete platformrolebinding <name>`.

Revoke делает `DELETE` этого PlatformRoleBinding и обновляет таблицу.

### A.8 Типовые потоки

1. **Admin открывает Projects.** Видит все namespace с меткой консоли, Create project, в kebab Edit / Permissions / Delete. Клик по `ml-team` ставит его выбранным и открывает Overview со всеми вкладками, которые дают его группы и rules.
2. **Создать проект.** Create project → имя `team-b` → квоты → Save. Появляется namespace и ResourceQuota `nova-ai-quota`. Компонентные вкладки в `team-b` сами не появляются: для них нужны группы `nova-ai-mlflow.team-b.*` и отдельные PlatformRole.
3. **Developer консоли на `ml-team`.** Строка `ml-team` есть. Create project нет, kebab пуст (нет ни update/delete namespace, ни manageRoles). Внутри Overview, без Roles и Permissions.
4. **Только группа MLflow.** В списке есть проект из имени группы. Внутри Overview и Experiments. Остальные вкладки скрыты.
5. **Сменить проект в шапке, сидя на Experiments.** Если у нового проекта Experiments нет, консоль уходит на его Overview.
6. **Выдать доступ из проекта.** Permissions → Grant access → Group + роль с селекторами. Биндинг создаётся с target Namespaces на этот проект и с аннотацией, поэтому Revoke в этом проекте активен.
7. **Увидеть биндинг из манифеста.** Он в таблице, если роль консольная и target покрывает проект. Revoke серый.
8. **Удалить роль.** Roles → kebab Delete → confirm. Роль пропадает из обеих таблиц после обновления. Биндинги на неё остаются, пока их не удалят отдельно.
9. **Открыть чужой URL `/projects/other/overview`.** Нет list namespaces и нет `canViewProject('other')` — Access denied, вкладок нет.

---

## 1. Список проектов

### 1.1 Маршруты и файлы

| URL | Компонент |
|---|---|
| `/projects` | `ProjectsList` |
| `/projects/:projectName` | redirect на `overview` |
| `/projects/:projectName/:tab` | `ProjectDetails` |
| `/projects/:projectName/deployments/:kind/:name` | `DeploymentDetails` с `projectScoped` |

```
distributions/nova-ai/src/pages/projects/
  ProjectsApp.tsx
  ProjectsList.tsx
  CreateProjectModal.tsx
  ProjectDetails.tsx
  ProjectSwitcher.tsx
  projectApi.ts
  selectedProjectStore.ts
  tabs/OverviewTab.tsx
  tabs/RolesTab.tsx
  tabs/PermissionsTab.tsx
  tabs/DeploymentsTab.tsx
  tabs/PlaceholderTab.tsx
```

Пункт sidebar `id: projects` в `extensions.ts` без `flags.required`.

### 1.2 Откуда строки

`listProjects` (`projectApi.ts`):

```
GET /api/v1/namespaces
GET /api/v1/resourcequotas
```

Namespace остаётся в сыром списке, если имя не начинается с `kube-` / `openshift-` и среди **значений** labels есть `nova-ai-console` (`hasConsoleScope` смотрит values, не только ключ `nova-ai.io/console`).

Квота для строки: в namespace предпочитается объект с именем `nova-ai-quota`, иначе первая встреченная.

Фильтр видимости в `ProjectsList`:

```
resourceAccess.listNamespaces || access.canViewProject(project.name)
```

`canViewProject` истинен, если расчёт access включил `seesAllProjects` (у биндинга target Cluster и в rules есть `list` namespaces) или имя есть в `visibleProjects`. В `visibleProjects` попадают namespace из биндингов `target: Namespaces` и namespace, вытащенные из имён групп `nova-ai-<product>.<namespace>.<level>`, плюс `ml-team` для группы `nova-ai.admins`.

Пагинация режет уже отфильтрованный и отсортированный массив. Смена сортировки или размера страницы возвращает на страницу 1. Сортируются Name, Status, Created.

### 1.3 Кнопки

| UI | Поле `useConsoleResourceAccess` | SSAR |
|---|---|---|
| Create project | `createNamespaces` | `create` core `namespaces` |
| Edit project | `updateNamespaces` | `update` |
| Delete project | `deleteNamespaces` | `delete` |
| Edit permissions и вкладки Roles/Permissions | `manageRoles` | `update` `platformroles` или `update` `platformrolebindings` |

Пока хук не загрузился, все четыре поля false, кнопки скрыты. Ошибка SSAR тоже даёт false.

`access.canCreateProjects` на эту кнопку не влияет.

---

## 2. Глобальный проект

`selectedProjectStore.ts` хранит строку в памяти и в `sessionStorage`. Пустая строка ключ удаляет.

`ProjectSwitcher` после загрузки имён синхронизирует store с URL `/projects/:name`, если этот name в списке. На остальных маршрутах store не затирается путём: остаётся последний годный проект, и от него `AuthToolbarItem` ставит флаги `workbench` / `experiments` / `deployments` / `kserve-settings`.

Переход по клику строки списка идёт на Overview и попадает в эффект switcher, который записывает имя из URL. Отдельного вызова `setSelectedProject` в `ProjectsList` нет.

---

## 3. Вкладки карточки

`PROJECT_TABS` в `ProjectDetails.tsx`:

```
overview, workbench, experiments, pipelines, deployments, roles, permissions
```

`roles` и `permissions` помечены `adminOnly`. В коде это значит `resourceAccess.manageRoles`, не `consoleRole === 'admin'`.

Deployments дополнительно вызывает `canI('list', 'serving.kserve.io', 'inferenceservices', projectName)`, чтобы вкладка появилась и тогда, когда rules в расчёте access не прочитались, а RoleBinding в namespace уже есть.

Скрытая вкладка в URL не рисуется: `Navigate` replace на ту, что доступна, с запасным `overview`. Если Overview тоже отфильтрован, активной остаётся первая из `visibleTabs` только когда requested уже не виден и при этом overview всё же в списке. Если не виден ни один таб, включая overview, условие access denied срабатывает раньше: нет list namespaces и нет `canViewProject`.

`DeploymentsTab` — обёртка над `DeploymentsPage` с фиксированным `projectName`: без dropdown проекта. Поля формы и status описаны в `docs/deployments-and-settings.md`. Кто может нажать Create там, считается `canEditDeployments` (rules `serving.kserve.io` и target биндинга), см. role-system.

---

## 4. Overview — поля

| UI | Источник |
|---|---|
| Name | `metadata.name` |
| Description | `nova-ai.io/description`, иначе `kubernetes.io/description` |
| Status | `status.phase`, иначе `Unknown` |
| Created | `metadata.creationTimestamp` как строка API, без `toLocaleString` |
| Quota Resource | ключи `spec.hard` / `status.hard` |
| Used | `status.used[key]` |
| Hard limit | значение hard |

Ссылки Roles и Permissions в блоке конфигурации ведут на те же URL, что и вкладки. Блок целиком скрыт без `manageRoles`.

---

## 5. Roles — запись в API

Create:

```
POST /apis/auth.nova-platform.io/v1alpha1/platformroles
```

Тело: `apiVersion`, `kind: PlatformRole`, `metadata.name`, `metadata.labels` консоли, `spec.kubernetes.clusterRoleSelectors` и/или `spec.oidc.applications`.

Update:

```
PUT /apis/auth.nova-platform.io/v1alpha1/platformroles/<name>
```

Тело без status: apiVersion, kind, metadata как у объекта, spec с заменёнными kubernetes и oidc.

Delete:

```
DELETE /apis/auth.nova-platform.io/v1alpha1/platformroles/<name>
```

Список ролей на вкладке — тот же `listPlatformRoles`, что и для расчёта access: только объекты с значением label `nova-ai-console`.

Bound here смотрит все PlatformRoleBinding, не только с меткой консоли, но оставляет те, чья роль есть в этом списке.

---

## 6. Permissions — запись в API

Список — `listPlatformRoleBindings`, затем фильтр по имени роли и `bindingAppliesToProject`.

Grant:

```
POST /apis/auth.nova-platform.io/v1alpha1/platformrolebindings
```

Имя через `dns1123Name`. Пример: проект `ml-team`, группа `nova-ai-mlflow.ml-team.developers`, роль `nova-ai-mlflow.ml-team` превращается в имя, где точки заменены на дефисы и повторные дефисы схлопнуты, обрезка 63 символа.

Аннотация, от которой зависит Revoke:

```
metadata.annotations['nova-ai.io/granted-in-project'] === <projectName>
```

Константа `GRANTED_IN_PROJECT_ANNOTATION` в `consoleScope.ts`. Сравнение строгое, другой проект в аннотации Revoke здесь не включает.

Revoke:

```
DELETE /apis/auth.nova-platform.io/v1alpha1/platformrolebindings/<name>
```

Пока запрос идёт, пункт disabled (`isSaving`).

Label `nova-ai.io/kubernetes-target` читается только в момент Grant. Уже существующий биндинг эта метка не переписывает.

---

## 7. Сценарии по коду

1. **Нет KUBECONFIG_BASE64** — empty state, switcher не рисуется (`connection` пуст).
2. **Не залогинен** — info на списке; proxy отвечает 401 «Sign in before calling the cluster.»
3. **Admin, list namespaces разрешён** — в таблице каждый Nova namespace из ответа API, в том числе проекты без личного биндинга.
4. **Developer с биндингом Namespaces `[ml-team]`** — в ответе API может быть один namespace или 403 на cluster list. Если list упал, Alert вместо таблицы. Если list вернул все namespace (учётка шире роли), фильтр оставит только `canViewProject`.
5. **Группа `nova-ai-airflow.ml-team.viewers`, других биндингов нет** — `ml-team` виден, вкладка Pipelines есть, Roles нет.
6. **Create с невалидным именем** — ошибка в модалке, POST нет.
7. **Create, namespace прошёл, квота нет** — namespace удаляется, в модалке ошибка.
8. **Edit описания в пустую строку** — аннотация `nova-ai.io/description` удаляется.
9. **Delete project** — confirm, DELETE namespace. Квоты уходят вместе с namespace.
10. **Открыть `/projects/ml-team/roles` без manageRoles** — replace на overview.
11. **Открыть `/projects/ml-team/nope`** — replace на overview.
12. **Create role без селекторов и без приложений** — ошибка формы, POST нет.
13. **Create role `Nova.Team`** — имя сохраняется как `nova.team`.
14. **Grant на роль с `kubernetes-target: Cluster`** — биндинг target Cluster, не Namespaces текущего проекта.
15. **Grant на роль только с OIDC** — target None, Bound here на Roles становится Yes, если имя роли кодирует этот namespace (`nova-ai-mlflow.ml-team`) или target покрывает проект.
16. **Revoke биндинга из yaml** — пункт disabled, клик не уходит в API.
17. **Delete role, на которую есть биндинг** — модалка остаётся открытой, внутри Alert с текстом API.
18. **Смена проекта в шапке со страницы `/projects/ml-team/permissions`** — переход на `/projects/<new>/permissions`. Если у нового проекта нет manageRoles, ProjectDetails заменит вкладку на overview.
19. **Поиск и пагинация** — фильтр по подстроке имени, описания и phase; страница обрезается после сортировки.
20. **Refresh** — повторный `listProjects` без перезагрузки приложения. Расчёт ролей при этом сам не повторяется: его кэш живёт, пока не сменится `sub` или подключение.

---

## 8. Карта кода

| Задача | Куда смотреть |
|---|---|
| Какие строки видны | `ProjectsList.tsx` фильтр + `access.canViewProject` |
| Create / Edit / Delete project | `projectApi.ts`, `CreateProjectModal.tsx` |
| Кнопки и kebab | `useConsoleResourceAccess.ts` |
| Выбор в шапке и редирект со скрытой вкладки | `ProjectSwitcher.tsx`, `selectedProjectStore.ts` |
| Набор вкладок | `ProjectDetails.tsx` `PROJECT_TABS` |
| Overview и блок configuration | `tabs/OverviewTab.tsx` |
| Форма роли и Delete | `tabs/RolesTab.tsx`, `deletePlatformRole` |
| Grant / Revoke и аннотация | `tabs/PermissionsTab.tsx`, `GRANTED_IN_PROJECT_ANNOTATION` |
| Метка «это проект консоли» | `consoleScope.ts` |
| Почему вкладка Experiments есть | `docs/role-system.md`, `componentServicesByNamespace` |

---

## 9. Ограничения текущей реализации

- Workbench, Experiments и Pipelines внутри проекта — заглушки. Данные MLflow, Airflow и JupyterHub консоль не читает.
- Pipelines нет в sidebar, только вкладка проекта.
- Имя проекта в форме не допускает точки. Имя PlatformRole допускает.
- `dns1123Name` при Grant выкидывает точки из имени биндинга. Длинная связка project + subject + role обрезается до 63 символов, разные пары могут схлопнуться в одно имя.
- Revoke выключен у всех биндингов без аннотации `nova-ai.io/granted-in-project` на этот проект, в том числе у выданных в другом проекте.
- Delete роли не каскадит на PlatformRoleBinding.
- Список проектов не следит за API watch. Обновление — Refresh, возврат после save или повторный заход.
- Кэш platform access не сбрасывается на Refresh списка. Новый биндинг начнёт влиять на вкладки после перезагрузки расчёта (смена сессии или повторный mount с другим cache key).
- Description на Overview показывается сырым timestamp API. В списке проектов тот же timestamp проходит через `toLocaleString()`.
