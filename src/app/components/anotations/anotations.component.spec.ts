import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnotationsComponent } from './anotations.component';

describe('AnotationsComponent', () => {
  let component: AnotationsComponent;
  let fixture: ComponentFixture<AnotationsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnotationsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AnotationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
