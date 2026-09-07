-- The legacy "PLANT HEAD" role (pre-dates the dynamic RBAC rebuild) never
-- had hierarchyLevel populated, so every `hierarchyLevel <= 2` oversight
-- check across the app (assignment stats/list, jobcard scoping, etc.) has
-- been silently treating Plant Head as NOT elevated. Give it its intended
-- position: Superadmin=0, Admin=1, Plant Head=2.
UPDATE `Role` SET `hierarchyLevel` = 2 WHERE `name` = 'PLANT HEAD' AND `hierarchyLevel` IS NULL;
