/**
 * Copyright 2023 LINE Corporation
 *
 * LINE Corporation licenses this file to you under the Apache License,
 * version 2.0 (the "License"); you may not use this file except in compliance
 * with the License. You may obtain a copy of the License at:
 *
 *   https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 */
import { faker } from '@faker-js/faker';
import { MailerService } from '@nestjs-modules/mailer';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { CodeTypeEnum } from '@/shared/code/code-type.enum';
import { CodeEntity } from '@/shared/code/code.entity';
import { CodeServiceProviders } from '@/shared/code/code.service.spec';
import { ResetPasswordMailingService } from '@/shared/mailing/reset-password-mailing.service';
import { getMockProvider, mockRepository } from '@/utils/test-utils';

import { ChangePasswordDto, ResetPasswordDto } from './dtos';
import { UserEntity } from './entities/user.entity';
import { InvalidPasswordException, UserNotFoundException } from './exceptions';
import { UserPasswordService } from './user-password.service';

const MockMailerService = {
  sendMail: jest.fn(),
};
const MockResetPasswordMailingService = {
  send: jest.fn(),
};

export const UserPasswordServiceProviders = [
  UserPasswordService,
  ...CodeServiceProviders,
  getMockProvider(ResetPasswordMailingService, MockResetPasswordMailingService),
  getMockProvider(MailerService, MockMailerService),
  {
    provide: getRepositoryToken(UserEntity),
    useValue: mockRepository(),
  },
];

describe('UserPasswordService', () => {
  let userPasswordService: UserPasswordService;
  let resetPasswordMailingService: ResetPasswordMailingService;
  let userRepo: Repository<UserEntity>;
  let codeRepo: Repository<CodeEntity>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: UserPasswordServiceProviders,
    }).compile();
    userPasswordService = module.get(UserPasswordService);
    resetPasswordMailingService = module.get(ResetPasswordMailingService);
    userRepo = module.get(getRepositoryToken(UserEntity));
    codeRepo = module.get(getRepositoryToken(CodeEntity));
  });

  describe('sendResetPasswordMail', () => {
    it('sending a reset password mail succeeds with valid inputs', async () => {
      const userId = faker.datatype.number();
      const email = faker.internet.email();
      jest
        .spyOn(userRepo, 'findOneBy')
        .mockResolvedValue({ id: userId } as UserEntity);

      await userPasswordService.sendResetPasswordMail(email);

      expect(userRepo.findOneBy).toHaveBeenCalledTimes(1);
      expect(userRepo.findOneBy).toHaveBeenCalledWith({ email });
      expect(resetPasswordMailingService.send).toHaveBeenCalledTimes(1);
    });
    it('sending a reset password mail fails with invalid email', async () => {
      const email = faker.internet.email();
      jest.spyOn(userRepo, 'findOneBy').mockResolvedValue(null as UserEntity);

      await expect(
        userPasswordService.sendResetPasswordMail(email),
      ).rejects.toThrow(UserNotFoundException);

      expect(userRepo.findOneBy).toHaveBeenCalledTimes(1);
      expect(userRepo.findOneBy).toHaveBeenCalledWith({ email });
      expect(resetPasswordMailingService.send).toHaveBeenCalledTimes(0);
    });
  });
  describe('resetPassword', () => {
    it('resetting a password succeeds with valid inputs', async () => {
      const dto = new ResetPasswordDto();
      dto.email = faker.internet.email();
      dto.code = faker.datatype.string();
      dto.password = faker.internet.password();
      const userId = faker.datatype.number();
      jest
        .spyOn(userRepo, 'findOneBy')
        .mockResolvedValue({ id: userId } as UserEntity);
      jest
        .spyOn(codeRepo, 'findOneBy')
        .mockResolvedValue({ code: dto.code } as CodeEntity);

      await userPasswordService.resetPassword(dto);

      expect(userRepo.findOneBy).toHaveBeenCalledTimes(1);
      expect(userRepo.findOneBy).toHaveBeenCalledWith({ email: dto.email });
      expect(codeRepo.findOneBy).toHaveBeenCalledTimes(1);
      expect(codeRepo.findOneBy).toHaveBeenCalledWith({
        key: dto.email,
        type: CodeTypeEnum.RESET_PASSWORD,
      });
      expect(userRepo.update).toHaveBeenCalledTimes(1);
      expect(userRepo.update).toHaveBeenCalledWith(
        { id: userId },
        {
          id: userId,
          hashPassword: expect.any(String),
        },
      );
    });
    it('resetting a password fails with an invalid email', async () => {
      const dto = new ResetPasswordDto();
      dto.email = faker.internet.email();
      dto.code = faker.datatype.string();
      dto.password = faker.internet.password();
      jest.spyOn(userRepo, 'findOneBy').mockResolvedValue(null as UserEntity);

      await expect(userPasswordService.resetPassword(dto)).rejects.toThrow(
        UserNotFoundException,
      );

      expect(userRepo.findOneBy).toHaveBeenCalledTimes(1);
      expect(userRepo.findOneBy).toHaveBeenCalledWith({ email: dto.email });
    });
  });
  describe('changePassword', () => {
    it('changing the password succeeds with valid inputs', async () => {
      const dto = new ChangePasswordDto();
      dto.userId = faker.datatype.number();
      dto.password = faker.internet.password();
      dto.newPassword = faker.internet.password();
      jest.spyOn(userRepo, 'findOneBy').mockResolvedValue({
        hashPassword: await userPasswordService.createHashPassword(
          dto.password,
        ),
      } as UserEntity);

      await userPasswordService.changePassword(dto);

      expect(userRepo.findOneBy).toHaveBeenCalledTimes(1);
      expect(userRepo.findOneBy).toHaveBeenCalledWith({ id: dto.userId });
      expect(userRepo.update).toHaveBeenCalledTimes(1);
      expect(userRepo.update).toHaveBeenCalledWith(
        { id: dto.userId },
        {
          id: dto.userId,
          hashPassword: expect.any(String),
        },
      );
    });
    it('changing the password fails with the invalid original password', async () => {
      const dto = new ChangePasswordDto();
      dto.userId = faker.datatype.number();
      dto.password = faker.internet.password();
      dto.newPassword = faker.internet.password();
      jest.spyOn(userRepo, 'findOneBy').mockResolvedValue({
        hashPassword: await userPasswordService.createHashPassword(
          faker.internet.password(),
        ),
      } as UserEntity);

      await expect(userPasswordService.changePassword(dto)).rejects.toThrow(
        InvalidPasswordException,
      );

      expect(userRepo.findOneBy).toHaveBeenCalledTimes(1);
      expect(userRepo.findOneBy).toHaveBeenCalledWith({ id: dto.userId });
    });
  });
  it('createHashPassword', async () => {
    const password = faker.internet.password();
    const hashPassword = await userPasswordService.createHashPassword(password);
    expect(bcrypt.compareSync(password, hashPassword)).toEqual(true);
  });
});