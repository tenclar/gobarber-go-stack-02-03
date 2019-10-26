import * as Yup from 'yup';

import { startOfHour, parseISO, isBefore, subHours, format } from 'date-fns';
import ptBR from 'date-fns/locale/pt-BR';
import User from '../models/User';
import File from '../models/File';
import Appointment from '../models/Appointment';
import Notification from '../schemas/Notification';
import CancellationMail from '../jobs/CancellationMail';

import Queue from '../../lib/Queue';

class AppointmentController {
  async index(req, res) {
    const { page = 1 } = req.query;
    const appointments = await Appointment.findAll({
      where: { user_id: req.userId, canceled_at: null },
      order: ['date'],
      attributes: ['id', 'date'],
      limit: 20,
      offset: (page - 1) * 20,
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['id', 'name'],
          include: [
            {
              model: File,
              as: 'avatar',
              attributes: ['id', 'path', 'url']
            }
          ]
        }
      ]
    });
    return res.json(appointments);
  }

  async store(req, res) {
    const schema = Yup.object().shape({
      provider_id: Yup.number().required(),
      date: Yup.date().required()
    });

    if (!(await schema.isValid(req.body))) {
      return res.status(400).json({ error: 'validation fields fails' });
    }
    const { provider_id, date } = req.body;

    /**
     * Check if provider_id is a providees
     */

    const checkIsProvider = await User.findOne({
      where: { id: provider_id, provider: true }
    });

    if (!checkIsProvider) {
      return res
        .status(401)
        .json({ error: 'you can only create appointment with providers' });
    }
    /**
     * check if privide_id is different user_id
     */
    if (provider_id === req.userId) {
      return res
        .status(401)
        .json({ error: `can't create appointment for yourself` });
    }

    /**
     * Check for past dates
     */

    const hourStart = startOfHour(parseISO(date));

    if (isBefore(hourStart, new Date())) {
      return res.status(400).json({ error: 'Past dates are not permitted' });
    }
    const checkAvailability = await Appointment.findOne({
      where: {
        provider_id,
        canceled_at: null,
        date: hourStart
      }
    });

    if (checkAvailability) {
      return res
        .status(400)
        .json({ error: 'Appointment date is not available' });
    }
    /**
     * Create Appointments
     *
     */

    const appointment = await Appointment.create({
      user_id: req.userId,
      provider_id,
      date: hourStart
    });
    /**
     *Notify appointment Provider
     *
     */
    const user = await User.findByPk(req.userId);
    const formattedDate = format(
      hourStart,
      "'dia' dd 'de' MMMM', às ' H:mm'h'",
      { locale: ptBR }
    );
    await Notification.create({
      content: `Novo agendamento de ${user.name} para o ${formattedDate}`,
      user: provider_id
    });

    return res.json(appointment);
  }

  async delete(req, res) {
    const appointment = await Appointment.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['name', 'email']
        },
        {
          model: User,
          as: 'user',
          attributes: ['name']
        }
      ]
    });

    /* const appointment = await Appointment.findOne({
      where: {
        id: req.params.id
      }
    }); */

    if (appointment.user_id !== req.userId) {
      return res.status(401).json({
        error: `You don't have permission to cancel this appointment`
      });
    }
    const dateWithSub = subHours(appointment.date, 2);

    if (isBefore(dateWithSub, new Date())) {
      return res.status(401).json({
        error: 'you can only cancel appointments 2 hours in advance'
      });
    }
    appointment.canceled_at = new Date();

    await appointment.save();
    /**
     *
     *  Process Mail
     */
    await Queue.add(CancellationMail.key, {
      appointment
    });

    return res.json(appointment);
  }
}
export default new AppointmentController();
