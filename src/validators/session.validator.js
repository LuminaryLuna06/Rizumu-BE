import Joi from "joi";
import { objectId, cleanText } from "./custom.js";

export const startSessionSchema = Joi.object({
  plannedDuration: Joi.number()
    .min(0)
    .max(24 * 3600)
    .optional(),
  timer_type: Joi.string().optional(),
  session_type: Joi.string().optional(),
  tag_id: Joi.string().allow(null, "").optional(),
  notes: Joi.string().max(500).allow("").optional(),
});

export const updateSessionSchema = Joi.object({
  session_id: objectId.optional(),
  duration: Joi.number().min(0).optional(),
  completed: Joi.boolean().optional(),
  ended_at: Joi.date().optional(),
  notes: Joi.string().max(500).allow("").optional(),
  tag_id: Joi.string().allow(null, "").optional(),
}).min(1);

export const timeRangeQuerySchema = Joi.object({
  startTime: Joi.date().required(),
  endTime: Joi.date().greater(Joi.ref("startTime")).required(),
  userId: objectId.optional(),
  user_id: objectId.optional(),
});

export const changeNoteSchema = Joi.object({
  notes: Joi.string().max(500).custom(cleanText).required(),
});
export const changeTagSchema = Joi.object({
  tag_id: Joi.string().allow("").optional(),
});
