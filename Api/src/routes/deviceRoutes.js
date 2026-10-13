import { Router } from 'express';
import {
  register,
  list,
  rename,
  remove,
  listDelegations,
  createDelegation,
  updateDelegation,
  removeDelegation,
} from '../controllers/deviceController.js';

// Mounted behind authMiddleware in app.js.
const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Devices
 *     description: Music Control Delegation, appareils rattachés au compte et licences de délégation par appareil
 *
 * components:
 *   schemas:
 *     Device:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *         platform: { type: string, example: ios }
 *         installationId: { type: string }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     RegisterDeviceInput:
 *       type: object
 *       required: [name, platform, installationId]
 *       properties:
 *         name: { type: string, maxLength: 100, example: 'iPhone de Léa' }
 *         platform: { type: string, maxLength: 50, example: ios }
 *         installationId: { type: string, maxLength: 191, description: "Identifiant stable de l'installation de l'application" }
 *     DelegationRights:
 *       type: object
 *       properties:
 *         canPlayPause: { type: boolean, default: true, description: 'Commandes play et pause' }
 *         canSkip: { type: boolean, default: true, description: 'Commandes next et previous' }
 *         canVolume: { type: boolean, default: true, description: 'Commande setVolume' }
 *     Delegation:
 *       allOf:
 *         - $ref: '#/components/schemas/DelegationRights'
 *         - type: object
 *           properties:
 *             id: { type: string }
 *             deviceId: { type: string }
 *             delegate: { $ref: '#/components/schemas/PublicUser' }
 *             active: { type: boolean }
 *             createdAt: { type: string, format: date-time }
 *             updatedAt: { type: string, format: date-time }
 */

/**
 * @swagger
 * /api/devices:
 *   post:
 *     summary: Enregistrer un appareil
 *     description: Le même installationId pour le même utilisateur renvoie l'appareil existant (200), avec son nom et sa plateforme mis à jour s'ils ont changé.
 *     tags: [Devices]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RegisterDeviceInput' }
 *     responses:
 *       201:
 *         description: Appareil créé
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Device' }
 *       200:
 *         description: Appareil déjà enregistré pour cette installation
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Device' }
 *       400:
 *         description: Entrée invalide (VALIDATION_ERROR)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401:
 *         description: Non authentifié
 *   get:
 *     summary: Lister mes appareils
 *     tags: [Devices]
 *     responses:
 *       200:
 *         description: Mes appareils
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Device' }
 *       401:
 *         description: Non authentifié
 */
router.post('/', register);
router.get('/', list);

/**
 * @swagger
 * /api/devices/{id}:
 *   patch:
 *     summary: Renommer un appareil
 *     tags: [Devices]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, maxLength: 100 }
 *     responses:
 *       200:
 *         description: Appareil renommé
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Device' }
 *       400:
 *         description: Entrée invalide (VALIDATION_ERROR)
 *       403:
 *         description: Appareil d'un autre utilisateur (NOT_DEVICE_OWNER)
 *       404:
 *         description: Appareil introuvable (DEVICE_NOT_FOUND)
 *   delete:
 *     summary: Supprimer un appareil
 *     description: >
 *       Supprime aussi toutes ses délégations. Les sockets quittent les canaux de l'appareil
 *       et chaque ancien délégué reçoit `device:revoked { deviceId, reason: 'DEVICE_DELETED' }`.
 *     tags: [Devices]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204:
 *         description: Appareil supprimé
 *       403:
 *         description: Appareil d'un autre utilisateur (NOT_DEVICE_OWNER)
 *       404:
 *         description: Appareil introuvable (DEVICE_NOT_FOUND)
 */
router.patch('/:id', rename);
router.delete('/:id', remove);

/**
 * @swagger
 * /api/devices/{id}/delegations:
 *   get:
 *     summary: Lister les délégations actives d'un appareil
 *     tags: [Devices]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Délégations actives
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Delegation' }
 *       403:
 *         description: Appareil d'un autre utilisateur (NOT_DEVICE_OWNER)
 *       404:
 *         description: Appareil introuvable (DEVICE_NOT_FOUND)
 *   post:
 *     summary: Déléguer le contrôle de cet appareil à un ami
 *     description: >
 *       La licence est propre à l'appareil : elle n'autorise aucun autre appareil.
 *       Seuls les amis acceptés peuvent être délégués. Si une délégation active existe déjà,
 *       ses droits sont mis à jour (200). Une délégation révoquée est réactivée (201).
 *       Les droits non fournis valent true pour une nouvelle délégation.
 *       Le délégué reçoit `delegation:updated { deviceId, rights, active }` sur ses sockets.
 *     tags: [Devices]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - type: object
 *                 required: [userId]
 *                 properties:
 *                   userId: { type: string, description: "Identifiant de l'ami" }
 *               - $ref: '#/components/schemas/DelegationRights'
 *     responses:
 *       201:
 *         description: Délégation créée
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Delegation' }
 *       200:
 *         description: Délégation existante, droits mis à jour
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Delegation' }
 *       400:
 *         description: Entrée invalide (VALIDATION_ERROR) ou délégation à soi-même (CANNOT_DELEGATE_SELF)
 *       403:
 *         description: Pas ami avec cet utilisateur (NOT_FRIENDS) ou appareil d'un autre utilisateur (NOT_DEVICE_OWNER)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Appareil introuvable (DEVICE_NOT_FOUND)
 */
router.get('/:id/delegations', listDelegations);
router.post('/:id/delegations', createDelegation);

/**
 * @swagger
 * /api/devices/{id}/delegations/{userId}:
 *   patch:
 *     summary: Modifier les droits d'une délégation
 *     description: Pris en compte dès la commande suivante. Le délégué reçoit `delegation:updated { deviceId, rights, active }`.
 *     tags: [Devices]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: userId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/DelegationRights' }
 *     responses:
 *       200:
 *         description: Droits mis à jour
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Delegation' }
 *       400:
 *         description: Aucun droit fourni ou valeur invalide (VALIDATION_ERROR)
 *       403:
 *         description: Appareil d'un autre utilisateur (NOT_DEVICE_OWNER)
 *       404:
 *         description: Appareil (DEVICE_NOT_FOUND) ou délégation active (DELEGATION_NOT_FOUND) introuvable
 *   delete:
 *     summary: Révoquer une délégation
 *     description: >
 *       Effet immédiat : la commande suivante du délégué est refusée (DELEGATION_FORBIDDEN),
 *       ses sockets ne reçoivent plus l'état de l'appareil et reçoivent
 *       `device:revoked { deviceId, reason: 'REVOKED' }`.
 *     tags: [Devices]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: userId, required: true, schema: { type: string } }
 *     responses:
 *       204:
 *         description: Délégation révoquée
 *       403:
 *         description: Appareil d'un autre utilisateur (NOT_DEVICE_OWNER)
 *       404:
 *         description: Appareil (DEVICE_NOT_FOUND) ou délégation active (DELEGATION_NOT_FOUND) introuvable
 */
router.patch('/:id/delegations/:userId', updateDelegation);
router.delete('/:id/delegations/:userId', removeDelegation);

export default router;
